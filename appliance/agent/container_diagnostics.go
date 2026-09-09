package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

type containerState struct {
	Running   bool   `json:"Running"`
	ExitCode  int    `json:"ExitCode"`
	OOMKilled bool   `json:"OOMKilled"`
	Error     string `json:"Error"`
}

// Keep only the tail even if one log line is huge.
type logTail struct{ data []byte }

func (b *logTail) Write(p []byte) (int, error) {
	n := len(p)
	const limit = 8192
	if len(p) >= limit {
		b.data = append(b.data[:0], p[len(p)-limit:]...)
		return n, nil
	}
	if extra := len(b.data) + len(p) - limit; extra > 0 {
		copy(b.data, b.data[extra:])
		b.data = b.data[:len(b.data)-extra]
	}
	b.data = append(b.data, p...)
	return n, nil
}

func failureDescription(state containerState, logs string) string {
	if state.Running {
		return ""
	}
	message := fmt.Sprintf("Container exited with code %d.", state.ExitCode)
	if state.OOMKilled {
		message += " It ran out of its assigned memory. Increase the memory allocation before retrying."
	}
	if state.ExitCode == 0 {
		message += " Its startup command finished. Use a long-running service or a keep-alive command for a terminal workspace."
	}
	if state.ExitCode == 132 {
		message += " The program used a CPU instruction unavailable in the runtime."
	}
	if state.Error != "" {
		message += " " + state.Error
	}
	if logs = strings.TrimSpace(logs); logs != "" {
		message += "\nRecent container output:\n" + logs
	}
	return message
}

func (s *server) containerDiagnostics(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/v1/containers/status/")
	if !requireID(w, id) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	output, err := run(ctx, "nerdctl", "--namespace", namespace, "inspect", "--format", "{{json .State}}", id)
	if err != nil {
		writeCommandError(w, err)
		return
	}
	var state containerState
	if err := json.Unmarshal([]byte(output.Stdout), &state); err != nil {
		writeError(w, 500, "Invalid container status: "+err.Error())
		return
	}
	var tail logTail
	if !state.Running {
		command := exec.CommandContext(ctx, "nerdctl", "--namespace", namespace, "logs", "--tail", "40", id)
		command.Stdout = &tail
		command.Stderr = &tail
		_ = command.Run()
	}
	writeJSON(w, 200, map[string]any{"running": state.Running, "message": failureDescription(state, string(tail.data))})
}
