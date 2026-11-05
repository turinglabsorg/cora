// A secret sent through Cora: the server hands over sealed bytes a set number of times,
// and only the key in this link's fragment, which never leaves the browser, opens them.
// A send for named people first sends its visitor to sign in: the key waits in this tab.
const root = document.getElementById("send");
if (root) {
  const KEY = /^[A-Za-z0-9_-]{43}$/;
  const slot = `cora-send:${location.host}${location.pathname}`;
  const remember = (key) => { try { if (KEY.test(key)) sessionStorage.setItem(slot, key); } catch {} };
  const recall = () => { try { return sessionStorage.getItem(slot) || ""; } catch { return ""; } };
  const forget = () => { try { sessionStorage.removeItem(slot); } catch {} };
  const fromLink = location.hash.slice(1);
  remember(fromLink);
  const bytes = (text) => {
    const plain = String(text).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(plain + "===".slice((plain.length + 3) % 4)), (char) => char.charCodeAt(0));
  };
  const open = document.getElementById("open");
  const password = document.getElementById("password");
  const error = document.getElementById("error");
  const say = (text) => { error.textContent = text; error.hidden = false; };
  const fail = (text) => { say(text); if (open) open.hidden = true; if (password) password.hidden = true; };
  document.getElementById("signin")?.addEventListener("click", () => remember(fromLink || recall()));
  password?.addEventListener("keydown", (event) => { if (event.key === "Enter") open?.click(); });
  open?.addEventListener("click", async () => {
    const key = KEY.test(fromLink) ? fromLink : recall();
    if (!KEY.test(key)) return fail(root.dataset.broken);
    if (password && !password.value) return password.focus();
    open.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch(root.dataset.open || location.pathname, {
        method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" },
        credentials: root.dataset.mode === "people" ? "same-origin" : "omit",
        body: JSON.stringify(password ? { password: password.value } : {}),
      });
      if (response.status === 401) { open.disabled = false; password?.select(); return say(root.dataset.wrong); }
      if (response.status === 429) { open.disabled = false; return say(root.dataset.tooMany); }
      if (response.status === 403) return fail(root.dataset.refused);
      if (!response.ok) return fail(root.dataset.gone);
      const sealed = await response.json();
      const cryptoKey = await crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, cryptoKey, bytes(sealed.data));
      document.getElementById("name").textContent = sealed.name;
      const field = document.getElementById("secret");
      field.value = new TextDecoder().decode(plain);
      document.getElementById("shown").hidden = false;
      open.hidden = true;
      if (password) password.hidden = true;
      for (const label of root.querySelectorAll('label[for="password"]')) label.hidden = true;
      // The key leaves the address bar and the tab: what is left on screen is only what was asked for.
      forget();
      history.replaceState(null, "", location.pathname);
      const copy = document.getElementById("copy");
      copy.addEventListener("click", () => navigator.clipboard?.writeText(field.value).then(() => { copy.textContent = root.dataset.copied; }));
    } catch {
      fail(root.dataset.broken);
    }
  });
}
