/* Vinayak Superstore cart — v1.1 */
function loadStoredCart() {
    try {
        const storedCart = JSON.parse(localStorage.getItem("cart"));
        return Array.isArray(storedCart) ? storedCart.filter(item => Number.isInteger(item.id) && item.quantity > 0) : [];
    } catch {
        localStorage.removeItem("cart");
        return [];
    }
}

let cart = loadStoredCart();
let cartTrigger = null;
let toastTimeout;

function formatPrice(value) { return `₹${Number(value).toLocaleString("en-IN")}`; }
function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function saveCart() {
    localStorage.setItem("cart", JSON.stringify(cart));
    updateCartCount();
}

function flyToCart(sourceImage) {
    const flyingImage = document.getElementById("flyingProduct");
    const cartButton = document.querySelector(".cart-button");
    if (!flyingImage || !cartButton || !sourceImage) return;
    const start = sourceImage.getBoundingClientRect();
    const end = cartButton.getBoundingClientRect();
    const initialSize = Math.max(start.width, 48);
    flyingImage.src = sourceImage.currentSrc || sourceImage.src;
    flyingImage.style.display = "block";
    flyingImage.style.opacity = "1";
    flyingImage.style.width = `${initialSize}px`;
    flyingImage.style.height = `${initialSize}px`;
    flyingImage.style.left = `${start.left + (start.width - initialSize) / 2}px`;
    flyingImage.style.top = `${start.top + (start.height - initialSize) / 2}px`;
    requestAnimationFrame(() => {
        flyingImage.style.left = `${end.left + end.width / 2 - 24}px`;
        flyingImage.style.top = `${end.top + end.height / 2 - 24}px`;
        flyingImage.style.width = "48px";
        flyingImage.style.height = "48px";
        flyingImage.style.opacity = ".2";
    });
    window.setTimeout(() => {
        flyingImage.style.display = "none";
        flyingImage.style.opacity = "1";
    }, 850);
}

async function addToCart(productId, quantity = 1) {
    const product = products.find(product => product.id === productId);
    const safeQuantity = Math.min(99, Math.max(1, Number.parseInt(quantity, 10) || 1));
    if (!product) return false;
    try {
        const response = await fetch("/api/checkout/quote", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ id: productId, quantity: safeQuantity }] })
        });
        const quote = await response.json();
        if (!response.ok) throw new Error(quote.error || "This product is unavailable.");
        product.price = quote.items[0].price;
        product.available = true;
    } catch (error) {
        showToast("Unable to add product", error.message);
        return false;
    }
    const existing = cart.find(item => item.id === productId);
    if (existing) existing.quantity = Math.min(99, existing.quantity + safeQuantity);
    else cart.push({ id: product.id, quantity: safeQuantity });
    saveCart();
    return true;
}

async function addCurrentProductToCart() {
    const overlay = document.getElementById("popupOverlay");
    const productId = Number(overlay.dataset.productId);
    const quantity = Number(document.getElementById("quantity").value);
    const product = products.find(item => item.id === productId);
    if (!product) return;
    if (!await addToCart(productId, quantity)) return;
    flyToCart(document.getElementById("popupImage"));
    closePopup();
    openCart();
    showToast("Added to cart", `${product.name} × ${quantity}`);
}

function setCartOpen(isOpen) {
    const drawer = document.getElementById("cartDrawer");
    const overlay = document.getElementById("cartOverlay");
    drawer.classList.toggle("show", isOpen);
    overlay.classList.toggle("show", isOpen);
    drawer.setAttribute("aria-hidden", String(!isOpen));
    document.body.classList.toggle("has-open-drawer", isOpen);
    if (isOpen) {
        const closeButton = drawer.querySelector(".cart-header button");
        closeButton?.focus();
    } else {
        cartTrigger?.focus();
    }
}

function openCart() {
    cartTrigger = document.activeElement;
    renderCart();
    setCartOpen(true);
}

function closeCart() { setCartOpen(false); }

function renderCart() {
    const cartItems = document.getElementById("cartItems");
    const totalElement = document.getElementById("cartTotal");
    let total = 0;
    const rows = cart.map(item => {
        const product = products.find(entry => entry.id === item.id);
        if (!product) return "";
        const unavailable = product.available === false;
        const subtotal = product.price * item.quantity;
        total += subtotal;
        return `<div class="cart-item">
            <img src="${getProductImage(product)}" alt="${escapeHTML(product.name)}" onerror="this.onerror=null;this.src='${productImageFallback}'">
            <div class="cart-info">
                <h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.brand)}</p>
                <strong>${formatPrice(product.price)} <span>each</span></strong>
                <small>${unavailable ? "Currently unavailable" : `Subtotal: ${formatPrice(subtotal)}`}</small>
            </div>
            <div class="cart-controls" aria-label="Quantity for ${escapeHTML(product.name)}">
                <button type="button" aria-label="Decrease ${escapeHTML(product.name)} quantity" onclick="changeCartQuantity(${product.id}, -1)">−</button>
                <span aria-live="polite">${item.quantity}</span>
                <button type="button" aria-label="Increase ${escapeHTML(product.name)} quantity" onclick="changeCartQuantity(${product.id}, 1)" ${unavailable ? "disabled" : ""}>+</button>
            </div>
            <button type="button" class="remove-btn" onclick="removeFromCart(${product.id})">Remove</button>
        </div>`;
    }).filter(Boolean);
    cartItems.innerHTML = rows.length ? rows.join("") : `<div class="empty-cart"><h3>Your cart is empty</h3><p>Add some products to begin shopping.</p></div>`;
    totalElement.textContent = formatPrice(total);
}

function changeCartQuantity(productId, change) {
    const product = products.find(entry => entry.id === productId);
    if (change > 0 && (!product || product.available === false)) return showToast("Currently unavailable", product?.name || "This product is unavailable.");
    const item = cart.find(entry => entry.id === productId);
    if (!item) return;
    if (change > 0 && item.quantity >= 99) return showToast("Quantity limit reached", "You can add up to 99 of one product.");
    item.quantity += change;
    if (item.quantity <= 0) return removeFromCart(productId);
    saveCart();
    renderCart();
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    renderCart();
}

function getCartCount() { return cart.reduce((sum, item) => sum + item.quantity, 0); }
function updateCartCount() {
    const badge = document.getElementById("cartCount");
    if (!badge) return;
    badge.textContent = getCartCount();
    badge.classList.remove("bump");
    void badge.offsetWidth;
    badge.classList.add("bump");
}

async function checkoutWhatsApp() {
    if (!cart.length) return showToast("Your cart is empty", "Add a product before checkout.");
    const checkoutWindow = window.open("about:blank", "_blank");
    try {
        const response = await fetch("/api/checkout/quote", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: cart.map(item => ({ id: item.id, quantity: item.quantity })) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Prices could not be verified.");
        let priceChanged = false;
        result.items.forEach(quoted => {
            const product = products.find(entry => entry.id === quoted.id);
            if (product && Number(product.price) !== Number(quoted.price)) priceChanged = true;
            if (product) { product.price = quoted.price; product.available = true; }
        });
        if (priceChanged) {
            renderCart();
            showToast("Cart prices refreshed", "The store's current prices are shown in your cart.");
        }
        const lines = result.items.map(item => `• ${item.name} × ${item.quantity} — ${formatPrice(item.subtotal)}`);
        const message = `Hello Vinayak Superstore!\n\nI'd like to order:\n${lines.join("\n")}\n\nTotal: ${formatPrice(result.total)}\n\nName:\nPhone:\nAddress:`;
        if (checkoutWindow) checkoutWindow.location.href = `https://wa.me/919779562555?text=${encodeURIComponent(message)}`;
        else window.location.href = `https://wa.me/919779562555?text=${encodeURIComponent(message)}`;
    } catch (error) {
        checkoutWindow?.close();
        showToast("Checkout could not be verified", error.message);
    }
}

function showToast(title, message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    document.getElementById("toastTitle").textContent = title;
    document.getElementById("toastMessage").textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2500);
}

updateCartCount();
