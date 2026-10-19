/* Vinayak Superstore interaction layer — v2.0 */
document.addEventListener("DOMContentLoaded", () => {
    const mediaMatches = query => window.matchMedia ? window.matchMedia(query).matches : false;
    const prefersReducedMotion = mediaMatches("(prefers-reduced-motion: reduce)");
    const supportsFinePointer = mediaMatches("(pointer: fine)");
    const loader = document.querySelector(".loader");
    const websiteVersion = "2.0";
    const updateOverlay = document.getElementById("updateOverlay");

    window.setTimeout(() => loader?.classList.add("hide"), prefersReducedMotion ? 0 : 700);

    function closeUpdateLog() {
        try { localStorage.setItem("websiteVersion", websiteVersion); } catch {}
        updateOverlay?.style.setProperty("display", "none");
    }

    document.getElementById("startShoppingBtn")?.addEventListener("click", closeUpdateLog);
    let savedVersion = "";
    try { savedVersion = localStorage.getItem("websiteVersion") || ""; } catch {}
    if (updateOverlay && savedVersion !== websiteVersion) updateOverlay.style.display = "flex";

    const header = document.querySelector("header");
    const progress = document.createElement("div");
    progress.className = "scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    document.body.appendChild(progress);
    const sections = [...document.querySelectorAll("main section[id]")];
    const navLinks = [...document.querySelectorAll(".nav-links a")];
    const navMenuButton = document.querySelector(".menu-btn");
    const mobileNavigation = document.getElementById("primary-navigation");
    const menuIcon = navMenuButton?.querySelector("i");
    function closeMobileNavigation() {
        mobileNavigation?.classList.remove("is-open");
        navMenuButton?.setAttribute("aria-expanded", "false");
        navMenuButton?.setAttribute("aria-label", "Open navigation menu");
        menuIcon?.classList.remove("fa-xmark");
        menuIcon?.classList.add("fa-bars");
    }
    navMenuButton?.addEventListener("click", () => {
        const willOpen = navMenuButton.getAttribute("aria-expanded") !== "true";
        mobileNavigation?.classList.toggle("is-open", willOpen);
        navMenuButton.setAttribute("aria-expanded", String(willOpen));
        navMenuButton.setAttribute("aria-label", willOpen ? "Close navigation menu" : "Open navigation menu");
        menuIcon?.classList.toggle("fa-bars", !willOpen);
        menuIcon?.classList.toggle("fa-xmark", willOpen);
    });
    mobileNavigation?.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMobileNavigation));
    document.addEventListener("click", event => {
        if (header && !header.contains(event.target)) closeMobileNavigation();
    });
    const heroImage = document.querySelector(".hero-right img");
    let scrollFrame = null;

    function updateScrollUI() {
        scrollFrame = null;
        const scrollTop = document.documentElement.scrollTop;
        const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        header?.classList.toggle("scrolled", scrollTop > 60);
        progress.style.transform = `scaleX(${maxScroll > 0 ? Math.min(scrollTop / maxScroll, 1) : 0})`;
        if (!prefersReducedMotion && heroImage) heroImage.style.transform = `translateY(${scrollTop * .08}px)`;
        let current = "";
        sections.forEach(section => { if (scrollTop >= section.offsetTop - 140) current = section.id; });
        navLinks.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${current}`));
    }

    window.addEventListener("scroll", () => {
        if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollUI);
    }, { passive: true });
    updateScrollUI();

    if (supportsFinePointer && !prefersReducedMotion) {
        const glow = document.querySelector(".cursor-glow");
        document.addEventListener("pointermove", event => {
            if (!glow) return;
            glow.style.left = `${event.clientX}px`;
            glow.style.top = `${event.clientY}px`;
        }, { passive: true });
    }

    const heroTitle = document.querySelector(".hero h1");
    const heroTexts = ["Everything You Need.<br>One Trusted Store.", "Imported Products.<br>Honest Prices.", "Hoshiarpur's Premium<br>Shopping Experience.", "Groceries.<br>Dairy.<br>Delivered."];
    if (heroTitle && !prefersReducedMotion) {
        let heroIndex = 0;
        window.setInterval(() => {
            heroTitle.style.opacity = "0";
            window.setTimeout(() => {
                heroIndex = (heroIndex + 1) % heroTexts.length;
                heroTitle.innerHTML = heroTexts[heroIndex];
                heroTitle.style.opacity = "1";
            }, 250);
        }, 4800);
    }

    const counters = document.querySelectorAll(".counter");
    if ("IntersectionObserver" in window) {
        const counterObserver = new IntersectionObserver(entries => entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const counter = entry.target;
            const target = Number(counter.dataset.target) || 0;
            const start = performance.now();
            const duration = prefersReducedMotion ? 1 : 900;
            const update = now => {
                const ratio = Math.min((now - start) / duration, 1);
                counter.textContent = `${Math.ceil(target * ratio)}${ratio === 1 ? "+" : ""}`;
                if (ratio < 1) requestAnimationFrame(update);
            };
            requestAnimationFrame(update);
            counterObserver.unobserve(counter);
        }), { threshold: .6 });
        counters.forEach(counter => counterObserver.observe(counter));
    } else {
        counters.forEach(counter => { counter.textContent = `${Number(counter.dataset.target) || 0}+`; });
    }

    function bindProductCardTilt() {
        if (!supportsFinePointer || prefersReducedMotion) return;
        document.querySelectorAll(".product-card").forEach(card => {
            if (card.dataset.tiltBound) return;
            card.dataset.tiltBound = "true";
            card.addEventListener("pointermove", event => {
                const rect = card.getBoundingClientRect();
                const rotateY = ((event.clientX - rect.left) / rect.width - .5) * 4;
                const rotateX = ((event.clientY - rect.top) / rect.height - .5) * -4;
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
            });
            card.addEventListener("pointerleave", () => { card.style.transform = ""; });
        });
    }
    bindProductCardTilt();
    document.addEventListener("products:rendered", bindProductCardTilt);

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        closeMobileNavigation();
        if (document.getElementById("popupOverlay")?.classList.contains("show")) closePopup();
        else if (document.getElementById("cartDrawer")?.classList.contains("show")) closeCart();
        else if (document.getElementById("wishlistDrawer")?.classList.contains("show")) closeWishlist();
        else if (document.getElementById("categoryDrawer")?.classList.contains("show")) closeDrawer();
    });

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}), { once: true });
    }
});
