use yougori_cli::{catalog, client, parse, wire, GUIDE, SKILL};
use serde_json::{json, Value};
use std::{io::Read, path::PathBuf};
mod output;

fn input(path: &str) -> Result<Value, String> {
    let mut bytes = Vec::new();
    let source: Box<dyn Read> = if path == "-" {
        Box::new(std::io::stdin())
    } else {
        Box::new(std::fs::File::open(path).map_err(|e| format!("Cannot read JSON file: {e}"))?)
    };
    source
        .take(wire::MAX_REQUEST as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > wire::MAX_REQUEST {
        return Err("JSON input exceeds 1 MB".into());
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    serde_json::from_slice(bytes).map_err(|e| format!("Invalid JSON input: {e}"))
}
fn install_skill(args: &[String]) -> Result<Value, String> {
    let mut path = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() { "--path" if path.is_none()=> { i+=1; path=Some(PathBuf::from(args.get(i).ok_or("--path requires a skill directory")?)); }, _=>return Err("Usage: skills install [--path SKILL_DIRECTORY]. Existing skills are never overwritten.".into()) }
        i += 1;
    }
    let path = match path {
        Some(path) => path,
        None => yougori_cli::skills::default_directory()?,
    };
    if path.exists() {
        return Err(format!("{} already exists; choose a new --path or update it explicitly. No files were changed.",path.display()));
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    yougori_cli::skills::install_at(&path, &executable)?;
    Ok(
        json!({"path":path,"message":"Installed Yougori skill. Start a new agent session to discover it. This skill does not grant additional system permissions."}),
    )
}
async fn run(args: Vec<String>) -> Result<i32, String> {
    if args.is_empty()
        || matches!(args[0].as_str(), "help" | "--help" | "-h")
        || (args.len() <= 4
            && args
                .last()
                .is_some_and(|s| matches!(s.as_str(), "--help" | "-h")))
    {
        print!("{}", output::help(parse::HELP, output::stdout_color()));
        return Ok(0);
    }
    if args[0] == "--version" {
        println!(
            "yougori-cli {} (protocol {})",
            env!("CARGO_PKG_VERSION"),
            wire::VERSION
        );
        return Ok(0);
    }
    if args[0] == "schema" {
        if args.len() > 2 {
            return Err("Usage: schema [METHOD]".into());
        }
        let result = if let Some(name) = args.get(1) {
            serde_json::to_value(catalog::find(name)?).unwrap()
        } else {
            json!({"protocolVersion":wire::VERSION,"methods":catalog::methods()})
        };
        println!("{}", output::json(&result, output::stdout_color()));
        return Ok(0);
    }
    if args[0] == "skills" {
        match args.get(1).map(String::as_str) {
            Some("print") if args.len() == 2 => println!("{SKILL}\n{GUIDE}"),
            Some("install") => println!("{}", wire_json(install_skill(&args[2..])?)),
            _ => {
                return Err("Usage: skills print | skills install [--path SKILL_DIRECTORY]".into())
            }
        }
        return Ok(0);
    }
    if args.starts_with(&["app".into(), "start".into()]) {
        let path = match &args[2..] {
            [] => None,
            [flag, path] if flag == "--app" => Some(path.as_str()),
            _ => return Err("Usage: app start [--app ABSOLUTE_EXECUTABLE_PATH]".into()),
        };
        println!("{}", wire_json(client::start(path).await?));
        return Ok(0);
    }
    let invocation = parse::parse(&args, input)?;
    let mut result = client::call(&invocation.request).await?;
    let explicit_wait = args.starts_with(&["jobs".into(), "wait".into()]);
    if !invocation.no_wait && (result["accepted"] == true || explicit_wait) {
        let job_id = result["jobId"]
            .as_str()
            .or_else(|| invocation.request.params["jobId"].as_str())
            .ok_or("Missing job ID")?
            .to_string();
        result = client::wait_job(&job_id, invocation.timeout).await?;
    }
    if !invocation.no_wait && !invocation.request.dry_run {
        result = parse::project(result, &invocation.select)?;
    }
    if invocation.markdown && result.is_string() {
        println!("{}", result.as_str().unwrap());
    } else {
        println!("{}", wire_json(result.clone()));
    }
    Ok(result["exitCode"]
        .as_i64()
        .filter(|v| *v != 0)
        .map(|v| v.clamp(1, 255) as i32)
        .unwrap_or(0))
}
fn wire_json(value: Value) -> String {
    output::json(&serde_json::to_value(wire::Response::success(value)).unwrap(), output::stdout_color())
}
fn main() {
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(run(std::env::args().skip(1).collect()));
    let code = match result {
        Ok(code) => code,
        Err(error) => {
            println!(
                "{}",
                output::json(&serde_json::to_value(wire::Response::failure(error)).unwrap(), output::stdout_color())
            );
            1
        }
    };
    std::process::exit(code);
}
