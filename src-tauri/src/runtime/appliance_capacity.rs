use super::RuntimeManager;
use crate::scheduler::APPLIANCE_OVERHEAD_GB;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ApplianceCapacity {
    pub cpus: usize,
    pub memory_mib: usize,
}

impl Default for ApplianceCapacity {
    fn default() -> Self {
        Self {
            cpus: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(1)
                .min(2),
            memory_mib: 1024,
        }
    }
}

impl ApplianceCapacity {
    pub fn for_workloads(cpu: f64, memory_gb: f64) -> Result<Self, String> {
        if !cpu.is_finite()
            || !memory_gb.is_finite()
            || cpu <= 0.0
            || memory_gb <= 0.0
            || cpu > 255.0
            || memory_gb > 1024.0
        {
            return Err("Invalid shared container runtime capacity".into());
        }
        Ok(Self {
            cpus: cpu.ceil() as usize,
            memory_mib: (((memory_gb + APPLIANCE_OVERHEAD_GB) * 8.0).ceil() as usize * 128)
                .max(1024),
        })
    }
    pub fn contains(self, requested: Self) -> bool {
        self.cpus >= requested.cpus && self.memory_mib >= requested.memory_mib
    }
}

impl RuntimeManager {
    /// Grow only an idle appliance. All container operations take a read lease;
    /// this exclusive lease prevents a start/provision/backup racing shutdown.
    pub async fn ensure_container_capacity(&self, cpu: f64, memory_gb: f64) -> Result<(), String> {
        let requested = ApplianceCapacity::for_workloads(cpu, memory_gb)?;
        let _exclusive = self.appliance_operations.write().await;
        let mut guard = self.appliance.lock().await;
        if let Some(process) = guard.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                if process.capacity.contains(requested) {
                    return Ok(());
                }
                if !process.active_containers.is_empty() {
                    return Err(format!("[OPENDOCK_CAPACITY_RESTART] More container runtime capacity is needed ({cpu:.2} CPUs, {memory_gb:.3} GB). Stop all running or paused containers, then retry. Yougori will resize the shared VM automatically and keep every container disk."));
                }
                let response = self
                    .client
                    .post(format!("{}/v1/system/shutdown", process.endpoint.base_url))
                    .bearer_auth(&process.endpoint.token)
                    .timeout(Duration::from_secs(3))
                    .send()
                    .await
                    .map_err(|e| {
                        format!("Could not shut down the idle runtime for resizing: {e}")
                    })?;
                if !response.status().is_success() {
                    return Err("The idle runtime refused a clean shutdown; no forced restart was attempted".into());
                }
                let status = tokio::time::timeout(Duration::from_secs(15), process.child.wait()).await
                    .map_err(|_| "The idle runtime is still shutting down. Retry in a moment; it was not force-killed.")?
                    .map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err("The idle runtime did not exit cleanly. No disk was replaced; retry after inspecting its error.".into());
                }
                self.record_appliance_overlay_state()?;
            }
            guard.take();
        }
        // Never boot a large VM merely because a slider's ceiling is high if the
        // host cannot currently back that reservation. Fail before touching disks.
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        let host_cpus = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1);
        if requested.cpus > host_cpus {
            return Err(format!(
                "The container runtime needs {} CPUs, but this computer has {host_cpus}",
                requested.cpus
            ));
        }
        let available_mib = system.available_memory() / 1_048_576;
        if requested.memory_mib as u64 + 512 > available_mib {
            return Err(format!("Not enough free host RAM to reserve {:.3} GB for the container runtime. Lower the resource maximum or close other workloads, then retry.", requested.memory_mib as f64 / 1024.0));
        }
        *self
            .appliance_capacity
            .lock()
            .map_err(|_| "Container capacity lock poisoned")? = requested;
        drop(guard);
        self.appliance_endpoint().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capacity_adds_control_plane_memory_without_a_tiny_fixed_ceiling() {
        let large = ApplianceCapacity::for_workloads(8.0, 8.0).unwrap();
        assert_eq!(
            large,
            ApplianceCapacity {
                cpus: 8,
                memory_mib: 8576
            }
        );
        assert!(!ApplianceCapacity::default().contains(large));
        assert!(large.contains(ApplianceCapacity::for_workloads(4.0, 4.0).unwrap()));
        assert_eq!(
            ApplianceCapacity::for_workloads(0.5, 0.5)
                .unwrap()
                .memory_mib,
            1024
        );
    }
    #[test]
    fn invalid_capacity_is_rejected() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(ApplianceCapacity::for_workloads(bad, 1.0).is_err());
            assert!(ApplianceCapacity::for_workloads(1.0, bad).is_err());
        }
    }
}
