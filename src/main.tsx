// Keep this entry dependency-free so the HTML loading screen can paint while
// React, the graph, styles and native platform state are being prepared.
void import("./bootstrap").catch(error => {
  console.error("Yougori frontend startup failed", error)
  const message = document.querySelector(".startup-message")
  if (message) {
    message.textContent = "Yougori couldn’t load. Please close and reopen the app."
    message.setAttribute("role", "alert")
  }
  document.querySelector(".startup-screen")?.setAttribute("aria-busy", "false")
  document.querySelector(".startup-track")?.remove()
})
