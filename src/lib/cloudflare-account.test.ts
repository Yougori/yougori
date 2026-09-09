import { describe, expect, it } from "vitest"
import { accountRequest, emptyCloudflareDraft } from "./cloudflare-account"

describe("optional Cloudflare account", () => {
  it("defaults to anonymous without retaining a token or opting into storage", () => {
    expect(emptyCloudflareDraft()).toEqual({ mode: "quick", hostname: "", localPort: "", token: "", remember: false, routesReviewed: false })
  })
  it("requires an explicit route review and a hostname / fixed bridge port", () => {
    const draft = { ...emptyCloudflareDraft(), hostname: "APP.Example.com", localPort: "45000", token: "test-token", routesReviewed: true }
    expect(accountRequest(draft)).toEqual({ hostPort: 45000, options: { hostname: "app.example.com", token: "test-token", remember: false, routesReviewed: true } })
    for (const hostname of ["https://app.example.com", "app.example.com:443", "user@app.example.com", "127.0.0.1", "app.local", "app.trycloudflare.com"]) expect(() => accountRequest({ ...draft, hostname })).toThrow()
    for (const localPort of ["", "0", "7443", "65536", "45000abc"]) expect(() => accountRequest({ ...draft, localPort })).toThrow()
    expect(() => accountRequest({ ...draft, routesReviewed: false })).toThrow(/Review/)
  })
  it("asks the backend to reuse a saved token without requesting the secret", () => {
    expect(accountRequest({ ...emptyCloudflareDraft(), hostname: "app.example.com", localPort: "45000", routesReviewed: true }).options.token).toBeUndefined()
  })
})
