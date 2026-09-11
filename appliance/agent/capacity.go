package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// Only the private QEMU appliance owns these memory devices. CUDA's WSL
// kernel is shared with other distributions and must not be changed here.
func (s *server) systemCapacity(w http.ResponseWriter, r *http.Request) {
	if s.microVM || os.Getenv("OPENDOCK_CUDA_MODE") == "1" {
		writeError(w, http.StatusConflict, "live capacity growth is only available for the standard container runtime")
		return
	}
	entries, err := filepath.Glob("/sys/devices/system/memory/memory[0-9]*/online")
	if err == nil {
		for _, path := range entries {
			value, readErr := os.ReadFile(path)
			if readErr != nil {
				continue
			}
			if strings.TrimSpace(string(value)) == "0" {
				if err = os.WriteFile(path, []byte("1"), 0600); err != nil {
					break
				}
			}
		}
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "bring runtime memory online: "+err.Error())
		return
	}
	info, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	memory, err := capacityMemoryBytes(string(info))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cpuCount": runtime.NumCPU(), "memoryBytes": memory})
}

func capacityMemoryBytes(info string) (uint64, error) {
	for _, line := range strings.Split(info, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 3 && fields[0] == "MemTotal:" && fields[2] == "kB" {
			value, err := strconv.ParseUint(fields[1], 10, 64)
			if err == nil && value > 0 && value <= ^uint64(0)/1024 {
				return value * 1024, nil
			}
		}
	}
	return 0, fmt.Errorf("runtime memory capacity is unavailable")
}
