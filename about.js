const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector(".site-menu");
const menuBackdrop = document.querySelector(".menu-backdrop");

function setMenuState(isOpen) {
  if (!menuToggle || !siteMenu || !menuBackdrop) {
    return;
  }

  menuToggle.classList.toggle("is-open", isOpen);
  siteMenu.classList.toggle("is-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  siteMenu.setAttribute("aria-hidden", String(!isOpen));
  menuBackdrop.hidden = !isOpen;
  document.body.style.overflow = isOpen ? "hidden" : "";
}

if (menuToggle && siteMenu && menuBackdrop) {
  menuToggle.addEventListener("click", () => {
    setMenuState(!siteMenu.classList.contains("is-open"));
  });

  menuBackdrop.addEventListener("click", () => setMenuState(false));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenuState(false);
  }
});
