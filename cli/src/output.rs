use serde_json::Value;
use std::io::IsTerminal;

fn enabled(terminal: bool, no_color: Option<&str>, term: Option<&str>) -> bool {
    terminal && !no_color.is_some_and(|value| !value.is_empty())
        && !matches!(term, Some("dumb" | "xterm-mono"))
}

pub fn stdout_color() -> bool {
    enabled(std::io::stdout().is_terminal(), std::env::var("NO_COLOR").ok().as_deref(), std::env::var("TERM").ok().as_deref())
}

fn paint(output: &mut String, text: &str, color: &str) {
    output.push_str(color);
    output.push_str(text);
    output.push_str("\x1b[0m");
}

pub fn json(value: &Value, color: bool) -> String {
    let plain = serde_json::to_string_pretty(value).unwrap();
    if !color { return plain; }
    // Tokenize the serializer's JSON, never the unescaped values themselves.
    // Removing our SGR sequences gives exactly the same JSON for every value.
    let bytes = plain.as_bytes();
    let mut output = String::with_capacity(plain.len());
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        match bytes[i] {
            b'"' => {
                i += 1;
                while i < bytes.len() {
                    match bytes[i] {
                        b'\\' => i += 2,
                        b'"' => { i += 1; break; }
                        _ => i += 1,
                    }
                }
                let key = plain[i..].trim_start().starts_with(':');
                paint(&mut output, &plain[start..i], if key { "\x1b[96m" } else { "\x1b[92m" });
            }
            b'-' | b'0'..=b'9' | b't' | b'f' | b'n' => {
                i += 1;
                while i < bytes.len() && !matches!(bytes[i], b',' | b']' | b'}' | b' ' | b'\r' | b'\n') { i += 1; }
                let token = &plain[start..i];
                paint(&mut output, token, match token {
                    "true" => "\x1b[92m", "false" => "\x1b[91m", "null" => "\x1b[90m", _ => "\x1b[93m",
                });
            }
            _ => { output.push(bytes[i] as char); i += 1; }
        }
    }
    output
}

pub fn help(text: &str, color: bool) -> String {
    if !color { return text.into(); }
    let mut output = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let content = line.strip_suffix('\n').unwrap_or(line);
        if content.starts_with("Yougori CLI") || content.ends_with(':') {
            paint(&mut output, content, "\x1b[1;96m");
        } else if let Some(command) = content.strip_prefix("  ").filter(|line| {
            line.split_whitespace().next().is_some_and(|word| matches!(word,
                "app" | "env" | "connection" | "share" | "ports" | "snapshot" | "backup" | "gpu" |
                "terminal" | "microvm" | "window" | "settings" | "jobs" | "skills" | "schema" | "call"))
        }) {
            let (usage, description) = command.split_once("  ").unwrap_or((command, ""));
            output.push_str("  ");
            paint(&mut output, usage, "\x1b[93m");
            if !description.is_empty() { output.push_str("  "); output.push_str(description); }
        } else { output.push_str(content); }
        if line.ends_with('\n') { output.push('\n'); }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    fn without_sgr(text: &str) -> String {
        let mut output = String::new();
        let mut chars = text.chars();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                assert_eq!(chars.next(), Some('['));
                for c in chars.by_ref() { if c == 'm' { break; } assert!(c.is_ascii_digit() || c == ';'); }
            } else { output.push(c); }
        }
        output
    }
    #[test]
    fn redirects_and_explicit_plain_text_preferences_never_receive_ansi() {
        for terminal in [false, true] {
            assert!(!enabled(terminal, Some("1"), Some("xterm-256color")));
            assert!(!enabled(terminal, None, Some("dumb")));
        }
        assert!(!enabled(false, None, Some("xterm-256color")));
        assert!(enabled(true, None, Some("xterm-256color")));
        assert!(enabled(true, Some(""), None));
    }
    #[test]
    fn coloured_json_round_trips_unicode_escapes_nested_values_and_numbers() {
        let value = serde_json::json!({"name":"żółty ✓", "quoted":"\"key\": false", "escape":"\x1b[31m", "path":"C:\\files\\", "values":[true,false,null,-4,2.5,1.23e30,{"inner":"test"}]});
        let plain = json(&value, false);
        let rendered = json(&value, true);
        assert_eq!(without_sgr(&rendered), plain);
        assert_eq!(serde_json::from_str::<Value>(&plain).unwrap(), value);
        assert!(rendered.contains("\x1b[96m\"name\"\x1b[0m"));
        assert!(rendered.contains("\x1b[91mfalse\x1b[0m"));
        assert!(!plain.contains('\x1b'));
        for value in [serde_json::json!(null), serde_json::json!("top-level ✓"), serde_json::json!(-0.2)] {
            assert_eq!(without_sgr(&json(&value, true)), json(&value, false));
        }
    }
    #[test]
    fn coloured_help_preserves_every_character_and_newline() {
        let plain = yougori_cli::parse::HELP;
        assert_eq!(without_sgr(&help(plain, true)), plain);
        assert_eq!(help(plain, false), plain);
        assert!(help(plain, true).contains("\x1b[93mapp start|status|show|quit"));
    }
}
