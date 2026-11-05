// A secret sent through Cora: the server hands over sealed bytes once, and only the
// key in this link's fragment, which never leaves the browser, opens them.
const root = document.getElementById("send");
if (root) {
  const bytes = (text) => {
    const plain = String(text).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(plain + "===".slice((plain.length + 3) % 4)), (char) => char.charCodeAt(0));
  };
  const open = document.getElementById("open");
  const fail = (text) => {
    const error = document.getElementById("error");
    error.textContent = text;
    error.hidden = false;
    open.hidden = true;
  };
  open.addEventListener("click", async () => {
    const key = location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return fail(root.dataset.broken);
    open.disabled = true;
    try {
      const response = await fetch(location.pathname, { method: "POST", headers: { "X-Cora": "1" }, credentials: "omit" });
      if (!response.ok) return fail(root.dataset.gone);
      const sealed = await response.json();
      const cryptoKey = await crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, cryptoKey, bytes(sealed.data));
      document.getElementById("name").textContent = sealed.name;
      const field = document.getElementById("secret");
      field.value = new TextDecoder().decode(plain);
      document.getElementById("shown").hidden = false;
      open.hidden = true;
      // The key leaves the address bar: what is left on screen is only what was asked for.
      history.replaceState(null, "", location.pathname);
      const copy = document.getElementById("copy");
      copy.addEventListener("click", () => navigator.clipboard?.writeText(field.value).then(() => { copy.textContent = root.dataset.copied; }));
    } catch {
      fail(root.dataset.broken);
    }
  });
}
