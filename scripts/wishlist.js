/* Vinayak Superstore wishlist — v1.1 */
function loadStoredWishlist() {
    try {
        const storedWishlist = JSON.parse(localStorage.getItem("wishlist"));
        return Array.isArray(storedWishlist) ? [...new Set(storedWishlist.filter(Number.isInteger))] : [];
    } catch {
        localStorage.removeItem("wishlist");
        return [];
    }
}

let wishlist = loadStoredWishlist();
let wishlistTrigger = null;

function saveWishlist() {
    localStorage.setItem("wishlist", JSON.stringify(wishlist));
    updateWishlistCount();
    renderWishlist();
}

function isWishlisted(id) { return wishlist.includes(id); }

function toggleWishlist(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    const saved = !isWishlisted(id);
    wishlist = saved ? [...wishlist, id] : wishlist.filter(item => item !== id);
    saveWishlist();
    showToast(saved ? "Saved to wishlist" : "Removed from wishlist", product.name);
    document.dispatchEvent(new CustomEvent("wishlist:updated"));
}

function updateWishlistCount() {
    const count = wishlist.length;
    document.getElementById("wishlistCount")?.replaceChildren(String(count));
    document.getElementById("wishlistDrawerCount")?.replaceChildren(`(${count})`);
}

function renderWishlist() {
    const container = document.getElementById("wishlistItems");
    if (!container) return;
    const rows = wishlist.map(id => products.find(product => product.id === id)).filter(Boolean).map(product => `
        <article class="wishlist-item">
            <img src="${getProductImage(product)}" alt="${escapeHTML(product.name)}" onerror="this.onerror=null;this.src='${productImageFallback}'">
            <div class="wishlist-info"><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.brand)}</p><div class="wishlist-rating">★ ${product.rating} <span>(${product.reviews})</span></div><strong>${formatPrice(product.price)}</strong></div>
            <div class="wishlist-actions"><button type="button" class="move-btn" onclick="moveWishlistToCart(${product.id})"><i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> Add</button><button type="button" class="remove-btn" onclick="toggleWishlist(${product.id})">Remove</button></div>
        </article>`);
    container.innerHTML = rows.length ? rows.join("") : `<div class="empty-wishlist"><h2 aria-hidden="true">♥</h2><h3>Your wishlist is empty</h3><p>Save products and they will always be one tap away.</p></div>`;
}

function setWishlistOpen(isOpen) {
    const drawer = document.getElementById("wishlistDrawer");
    const overlay = document.getElementById("wishlistOverlay");
    drawer.classList.toggle("show", isOpen);
    overlay.classList.toggle("show", isOpen);
    drawer.setAttribute("aria-hidden", String(!isOpen));
    document.body.classList.toggle("has-open-drawer", isOpen);
    if (isOpen) drawer.querySelector(".wishlist-header button")?.focus();
    else wishlistTrigger?.focus();
}

function openWishlist() { wishlistTrigger = document.activeElement; renderWishlist(); setWishlistOpen(true); }
function closeWishlist() { setWishlistOpen(false); }

async function moveWishlistToCart(productId) {
    const product = products.find(item => item.id === productId);
    if (!product) return;
    if (!await addToCart(productId, 1)) return;
    wishlist = wishlist.filter(id => id !== productId);
    saveWishlist();
    openCart();
    showToast("Moved to cart", product.name);
}

updateWishlistCount();
renderWishlist();
