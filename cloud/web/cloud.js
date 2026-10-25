// usecora.space: small touches on top of pages that work without them.
document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", () => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Sections fade in as they reach the screen.
  const reveals = document.querySelectorAll(".reveal");
  if (still || !("IntersectionObserver" in window)) reveals.forEach((el) => el.classList.add("in"));
  else {
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        watcher.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => watcher.observe(el));
  }

  // The orb: every pulse is an agent doing something, in its own color.
  const orb = document.querySelector("[data-orb]");
  if (orb && !still) {
    const chips = [...orb.querySelectorAll(".pulse-chip")];
    const rings = [...orb.querySelectorAll(".orb-rings i")];
    const stage = orb.querySelector(".orb-stage");
    const tint = (hex, alpha) => {
      const value = parseInt(hex.replace("#", ""), 16);
      return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${alpha})`;
    };
    let count = 0;
    const pulse = () => {
      const chip = chips[count % chips.length];
      const color = chip.style.getPropertyValue("--c").trim() || "#f2a93b";
      const ring = rings[count % rings.length];
      ring.style.setProperty("--c", color);
      ring.classList.remove("go");
      void ring.offsetWidth;
      ring.classList.add("go");
      stage.style.setProperty("--glow", tint(color, 0.3));
      orb.classList.remove("beat");
      void orb.offsetWidth;
      orb.classList.add("beat");
      chip.classList.add("on");
      const phone = matchMedia("(max-width: 719px)").matches;
      setTimeout(() => chip.classList.remove("on"), phone ? 2000 : 4400);
      count += 1;
    };
    setTimeout(() => {
      pulse();
      setInterval(pulse, 2300);
    }, 600);
  }

  // The console plays its transcript one line at a time, then starts over.
  const teletype = document.querySelector("[data-teletype]");
  const clock = document.querySelector("[data-clock]");
  if (teletype) {
    const lines = [...teletype.children];
    if (!still) {
      let index = 0;
      const next = () => {
        if (index === lines.length) {
          setTimeout(() => {
            lines.forEach((line) => line.classList.remove("shown", "typing"));
            index = 0;
            setTimeout(next, 800);
          }, 7000);
          return;
        }
        const line = lines[index++];
        lines.forEach((other) => other.classList.remove("typing"));
        line.classList.add("shown", "typing");
        if (clock) clock.textContent = line.querySelector("time").textContent;
        setTimeout(next, line.classList.contains("ask") ? 2800 : line.classList.contains("tool") ? 1200 : 1700);
      };
      // The whole transcript is there at first; the replay starts after a moment.
      setTimeout(() => {
        lines.forEach((line) => line.classList.remove("shown"));
        setTimeout(next, 700);
      }, 4500);
    }
  }

  // The red line on the day ruler is now.
  const now = document.querySelector("[data-now]");
  if (now) {
    const place = () => {
      const date = new Date();
      now.style.left = `${((date.getHours() * 60 + date.getMinutes()) / 1440) * 100}%`;
    };
    place();
    setInterval(place, 60000);
  }

  // The space name types itself: yourcompany, acme, studio...
  const name = document.querySelector("[data-names]");
  if (name && !still) {
    const names = name.dataset.names.split(",");
    let current = 0;
    const erase = () => {
      if (name.textContent.length) {
        name.textContent = name.textContent.slice(0, -1);
        return setTimeout(erase, 45);
      }
      current = (current + 1) % names.length;
      setTimeout(type, 250);
    };
    const type = () => {
      const target = names[current];
      if (name.textContent.length < target.length) {
        name.textContent = target.slice(0, name.textContent.length + 1);
        return setTimeout(type, 90);
      }
      setTimeout(erase, 2400);
    };
    setTimeout(erase, 2600);
  }
});
