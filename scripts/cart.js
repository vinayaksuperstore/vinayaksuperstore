/* Vinayak Superstore cart — v1.1 */
function loadStoredCart() {
    try {
        const storedCart = JSON.parse(localStorage.getItem("cart"));
        return Array.isArray(storedCart) ? storedCart.filter(item => Number.isInteger(item.id) && item.id > 0 && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99) : [];
    } catch {
        try { localStorage.removeItem("cart"); } catch {}
        return [];
    }
}

let cart = loadStoredCart();
let cartTrigger = null;
let toastTimeout;
let checkoutReturnFocus = null;
let customerDetails = { name: "", phone: "", address: "" };
let currentQuote = null;
let orderRequestKey = null;
let orderSubmitting = false;
let acceptedOrder = null;

function formatPrice(value) { return `₹${Number(value).toLocaleString("en-IN")}`; }
function isValidPrice(value) {
    return (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
        && Number.isFinite(Number(value))
        && Number(value) >= 0;
}
function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function saveCart() {
    try { localStorage.setItem("cart", JSON.stringify(cart)); } catch {}
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
    const existing = cart.find(item => item.id === productId);
    if (existing && existing.quantity + safeQuantity > 99) {
        showToast("Quantity limit reached", "You can add up to 99 of one product.", "error");
        return false;
    }
    if (product.available === false) {
        showToast("Unable to add product", "This product is currently unavailable.", "error");
        return false;
    }

    let rejectedByStore = "";
    try {
        const response = await fetch("/api/checkout/quote", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ id: productId, quantity: safeQuantity }] })
        });
        const quote = await readJsonResponse(response);
        // Honor clear client/product errors from the store. Empty, malformed,
        // or unavailable quote responses do not make browsing fail; checkout
        // still requires a fresh server quote before an order can be placed.
        if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 404) {
            rejectedByStore = quote?.error || "The store could not confirm this product. Please refresh and try again.";
        } else if (response.ok) {
            const quotedItem = Array.isArray(quote?.items)
                ? quote.items.find(item => Number(item.id) === Number(productId))
                : null;
            if (quotedItem && isValidPrice(quotedItem.price)) {
                product.price = Number(quotedItem.price);
                product.available = true;
            }
        }
    } catch {
        // A transient network/proxy failure should not empty the shopping flow.
        // The order path below continues to fail closed without a valid quote.
    }

    if (rejectedByStore) {
        showToast("Unable to add product", rejectedByStore, "error");
        return false;
    }
    if (!isValidPrice(product.price)) {
        showToast("Unable to add product", "The current price is unavailable. Please refresh and try again.", "error");
        return false;
    }
    if (existing) existing.quantity += safeQuantity;
    else cart.push({ id: product.id, quantity: safeQuantity });
    saveCart();
    return true;
}

async function readJsonResponse(response) {
    const body = await response.text();
    if (!body.trim()) return null;
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
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
    showToast("Added to cart", `${product.name} × ${quantity}. Price and availability are confirmed again at checkout.`);
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

function openCart(returnFocus = document.activeElement) {
    cartTrigger = returnFocus;
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
        if (!product) return `<div class="cart-item cart-item-missing"><div class="cart-info"><h3>Product unavailable</h3><p>This saved item is not in the current catalogue.</p></div><button type="button" class="remove-btn" onclick="removeFromCart(${item.id})">Remove</button></div>`;
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
    const checkoutButton=document.querySelector(".checkout-btn");
    if(checkoutButton) checkoutButton.disabled=!cart.length||!products.length||cart.some(item=>!products.some(product=>Number(product.id)===item.id));
}

function changeCartQuantity(productId, change) {
    const product = products.find(entry => entry.id === productId);
    if (change > 0 && (!product || product.available === false)) return showToast("Currently unavailable", product?.name || "This product is unavailable.", "error");
    const item = cart.find(entry => entry.id === productId);
    if (!item) return;
    if (change > 0 && item.quantity >= 99) return showToast("Quantity limit reached", "You can add up to 99 of one product.", "error");
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

function normalizeIndianPhone(value) {
    let digits=String(value||"").replace(/\D/g,"");
    if(digits.startsWith("0091")&&digits.length===14) digits=digits.slice(4);
    else if(digits.startsWith("91")&&digits.length===12) digits=digits.slice(2);
    else if(digits.startsWith("0")&&digits.length===11) digits=digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits)?{digits,normalized:`+91${digits}`} : null;
}

function formattedIndianPhone(value) {
    const normalized=normalizeIndianPhone(value);
    return normalized?`+91 ${normalized.digits.slice(0,5)} ${normalized.digits.slice(5)}`:String(value||"");
}

function checkoutElement(id) { return document.getElementById(id); }

function setFieldError(inputId,errorId,message) {
    const input=checkoutElement(inputId);
    const error=checkoutElement(errorId);
    if(!input||!error) return;
    input.setAttribute("aria-invalid",String(Boolean(message)));
    error.textContent=message||"";
    error.hidden=!message;
}

function captureCustomerDetails() {
    customerDetails={
        name:checkoutElement("customerName")?.value.trim().replace(/\s+/g," ")||"",
        phone:checkoutElement("customerPhone")?.value.trim()||"",
        address:checkoutElement("customerAddress")?.value.trim().replace(/\r\n?/g,"\n")||""
    };
}

function fillCustomerDetails() {
    if(checkoutElement("customerName")) checkoutElement("customerName").value=customerDetails.name;
    if(checkoutElement("customerPhone")) checkoutElement("customerPhone").value=customerDetails.phone;
    if(checkoutElement("customerAddress")) checkoutElement("customerAddress").value=customerDetails.address;
}

function validateCustomerDetails() {
    captureCustomerDetails();
    const phone=normalizeIndianPhone(customerDetails.phone);
    const errors={
        name:customerDetails.name?"":"Please enter your full name.",
        phone:phone?"":"Please enter a valid phone number.",
        address:customerDetails.address?"":"Please enter your delivery address."
    };
    setFieldError("customerName","customerNameError",errors.name);
    setFieldError("customerPhone","customerPhoneError",errors.phone);
    setFieldError("customerAddress","customerAddressError",errors.address);
    return Object.values(errors).every(value=>!value)?{...customerDetails,phone:phone.normalized}:null;
}

async function postCheckoutJSON(url,payload) {
    const controller=typeof AbortController==="function"?new AbortController():null;
    let timer;
    try {
        const request=fetch(url,{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            credentials:"same-origin",
            cache:"no-store",
            body:JSON.stringify(payload),
            ...(controller?{signal:controller.signal}:{})
        });
        const timeout=new Promise((_,reject)=>{
            timer=window.setTimeout(()=>{
                controller?.abort();
                reject(new Error("The store is taking too long to respond. Please try again."));
            },12000);
        });
        const response=await Promise.race([request,timeout]);
        let result={};
        try { result=await response.json(); } catch {}
        if(!response.ok){
            const localHost=["localhost","127.0.0.1","[::1]"].includes(window.location.hostname);
            const fallbackMessage=localHost&&response.status===404
                ?"The checkout API is unavailable in VS Code Live Server. Start the API-backed preview from LOCAL_PREVIEW.md."
                :"The request could not be completed.";
            const error=new Error(result.error||fallbackMessage);
            error.data=result;
            throw error;
        }
        return result;
    } finally { window.clearTimeout(timer); }
}

function updateQuotePrices(quote) {
    let priceChanged=false;
    for(const quoted of quote.items||[]){
        const product=products.find(entry=>Number(entry.id)===Number(quoted.id));
        if(product&&Number(product.price)!==Number(quoted.price)) priceChanged=true;
        if(product){product.price=Number(quoted.price);product.available=true;}
    }
    if(priceChanged) renderCart();
}

function showCheckoutStep(step) {
    const overlay=checkoutElement("checkoutOverlay");
    const modal=checkoutElement("checkoutModal");
    const details=checkoutElement("checkoutDetailsStep");
    const review=checkoutElement("checkoutReviewStep");
    const confirmation=checkoutElement("checkoutConfirmationStep");
    if(!overlay||!modal||!details||!review||!confirmation) return;
    details.hidden=step!=="details";
    review.hidden=step!=="review";
    confirmation.hidden=step!=="confirmation";
    const heading=step==="details"?"checkoutTitle":step==="review"?"reviewTitle":"confirmationTitle";
    modal.setAttribute("aria-labelledby",heading);
    if(step==="details") modal.setAttribute("aria-describedby","checkoutDescription");
    else modal.removeAttribute("aria-describedby");
    window.requestAnimationFrame(()=>{
        const focusTarget=step==="details"?checkoutElement("customerName"):checkoutElement(heading);
        focusTarget?.focus();
    });
}

function beginCheckout() {
    if(!cart.length) return showToast("Your cart is empty","Add a product before checkout.");
    if(!products.length) return showToast("Products are still loading","Please wait for the catalogue or use its retry button.");
    if(cart.some(item=>!products.some(product=>Number(product.id)===item.id))) return showToast("Review your cart","Remove any saved item that is no longer in the catalogue.");
    checkoutReturnFocus=document.activeElement;
    currentQuote=null;
    const modal=checkoutElement("checkoutOverlay");
    if(!modal) return showToast("Checkout is unavailable","Please refresh the page and try again.");
    setCartOpen(false);
    modal.hidden=false;
    modal.setAttribute("aria-hidden","false");
    document.body.classList.add("checkout-open");
    fillCustomerDetails();
    checkoutElement("detailsCheckoutError").hidden=true;
    checkoutElement("reviewCheckoutError").hidden=true;
    setFieldError("customerName","customerNameError","");
    setFieldError("customerPhone","customerPhoneError","");
    setFieldError("customerAddress","customerAddressError","");
    showCheckoutStep("details");
}

function closeCheckoutToCart() {
    if(orderSubmitting) return;
    const overlay=checkoutElement("checkoutOverlay");
    if(overlay){overlay.hidden=true;overlay.setAttribute("aria-hidden","true");}
    document.body.classList.remove("checkout-open");
    const focusTarget=checkoutReturnFocus?.isConnected?checkoutReturnFocus:document.querySelector(".cart-button");
    openCart(focusTarget);
}

async function continueToReview(event) {
    event.preventDefault();
    const details=validateCustomerDetails();
    if(!details){
        ["customerName","customerPhone","customerAddress"].find(id=>checkoutElement(id)?.getAttribute("aria-invalid")==="true")&&
            checkoutElement(["customerName","customerPhone","customerAddress"].find(id=>checkoutElement(id)?.getAttribute("aria-invalid")==="true"))?.focus();
        return;
    }
    if(!cart.length){
        checkoutElement("detailsCheckoutError").textContent="Your cart is empty. Add a product before checkout.";
        checkoutElement("detailsCheckoutError").hidden=false;
        return;
    }
    const button=checkoutElement("continueToReview");
    button.disabled=true;
    button.textContent="Checking current prices…";
    checkoutElement("detailsCheckoutError").hidden=true;
    try {
        const items=cart.map(item=>({id:item.id,quantity:item.quantity}));
        const quote=await postCheckoutJSON("/api/checkout/quote",{items});
        if(!Array.isArray(quote.items)||quote.items.length!==items.length) throw new Error("The store returned an incomplete order quote. Please try again.");
        currentQuote={...quote,items:items.map(item=>quote.items.find(quoted=>Number(quoted.id)===item.id&&Number(quoted.quantity)===item.quantity)).filter(Boolean)};
        if(currentQuote.items.length!==items.length) throw new Error("Your cart changed while prices were checked. Please review it and try again.");
        updateQuotePrices(currentQuote);
        renderOrderReview(details,currentQuote);
        showCheckoutStep("review");
    } catch(error) {
        checkoutElement("detailsCheckoutError").textContent=error.message||"We couldn’t verify the current prices. Please try again.";
        checkoutElement("detailsCheckoutError").hidden=false;
    } finally {
        button.disabled=false;
        button.textContent="Continue";
    }
}

function renderQuotedItems(items,target) {
    target.innerHTML=items.map(item=>`<div class="review-item"><strong>${escapeHTML(item.name)}</strong><small>${item.quantity} × ${formatPrice(item.price)}</small><span>${formatPrice(item.subtotal)}</span></div>`).join("");
}

function renderOrderReview(details,quote) {
    checkoutElement("reviewCustomer").innerHTML=`<strong>${escapeHTML(details.name)}</strong><p>${escapeHTML(formattedIndianPhone(details.phone))}</p><p>${escapeHTML(details.address).replace(/\n/g,"<br>")}</p>`;
    renderQuotedItems(quote.items,checkoutElement("reviewItems"));
    const deliveryLabel=quote.delivery?.status==="area_check_pending"
        ? "Service area check pending"
        : "Charge to be confirmed";
    checkoutElement("reviewTotals").innerHTML=`<div><span>Products subtotal</span><strong>${formatPrice(quote.subtotal)}</strong></div><div><span>Delivery</span><strong>${deliveryLabel}</strong></div><div class="review-total"><span>Subtotal · delivery not included</span><strong>${formatPrice(quote.subtotal)}</strong></div>`;
    checkoutElement("reviewNote").textContent="Free delivery above ₹500 is advertised within the store’s service area. The store must confirm whether your address is covered and any delivery charge. The website lists UPI, cards, and cash; payment is not taken at checkout, and the store will confirm the available method.";
    checkoutElement("reviewCheckoutError").hidden=true;
}

function getOrderRequestKey() {
    if(orderRequestKey) return orderRequestKey;
    try {
        const saved=sessionStorage.getItem("vinayakCheckoutRequestKey");
        if(saved&&/^[a-f0-9]{32}$/.test(saved)) return orderRequestKey=saved;
    } catch {}
    if(!window.crypto?.getRandomValues) throw new Error("This browser cannot safely start checkout. Please use an up-to-date browser.");
    const bytes=new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    orderRequestKey=[...bytes].map(byte=>byte.toString(16).padStart(2,"0")).join("");
    try { sessionStorage.setItem("vinayakCheckoutRequestKey",orderRequestKey); } catch {}
    return orderRequestKey;
}

function renderOrderConfirmation(order) {
    const lines=Array.isArray(order.items)?order.items:[];
    const total=order.total===null||order.total===undefined?"To be confirmed":formatPrice(order.total);
    checkoutElement("confirmationCopy").textContent=order.total===null||order.total===undefined
        ? `Vinayak Superstore has received order ${order.orderId}. The store will confirm the final amount. No payment has been taken.`
        : `Vinayak Superstore has received order ${order.orderId}. The store will confirm the delivery charge and final amount. No payment has been taken.`;
    checkoutElement("confirmationDetails").innerHTML=`
        <div><dt>Order ID</dt><dd>${escapeHTML(order.orderId)}</dd></div>
        <div><dt>${order.total===null||order.total===undefined?"Products subtotal":"Final amount"}</dt><dd>${order.total===null||order.total===undefined?formatPrice(order.subtotal):total}</dd></div>
        <div><dt>Delivery</dt><dd>${order.deliveryStatus==="confirmed"?formatPrice(order.deliveryCharge):order.deliveryStatus==="area_check_pending"?"Service area check pending":"Charge to be confirmed"}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHTML(formattedIndianPhone(order.customer.phone))}</dd></div>
        <div><dt>Payment</dt><dd>Not taken; the store will confirm a method (website lists UPI, cards, and cash)</dd></div>
        <div class="address-detail"><dt>Delivery address</dt><dd>${escapeHTML(order.customer.address)}</dd></div>`;
    renderQuotedItems(lines,checkoutElement("confirmationItems"));
    const whatsappText=`Hello Vinayak Superstore, I placed order ${order.orderId}. Please confirm the delivery charge and payment method.`;
    checkoutElement("confirmationWhatsApp").href=`https://wa.me/919779562555?text=${encodeURIComponent(whatsappText)}`;
    showCheckoutStep("confirmation");
}

async function placeOrder() {
    if(orderSubmitting) return;
    if(!cart.length||!currentQuote) return showToast("Review required","Please check your cart and current prices again.");
    const sameCart=cart.length===currentQuote.items.length&&cart.every(item=>currentQuote.items.some(quoted=>Number(quoted.id)===item.id&&Number(quoted.quantity)===item.quantity));
    if(!sameCart){
        checkoutElement("reviewCheckoutError").textContent="Your cart changed. Go back to edit it, then check the updated order before placing it.";
        checkoutElement("reviewCheckoutError").hidden=false;
        return;
    }
    captureCustomerDetails();
    const phone=normalizeIndianPhone(customerDetails.phone);
    if(!phone||!customerDetails.name||!customerDetails.address){
        currentQuote=null;
        showCheckoutStep("details");
        return;
    }
    const button=checkoutElement("placeOrderButton");
    orderSubmitting=true;
    button.disabled=true;
    button.textContent="Placing order…";
    checkoutElement("reviewCheckoutError").hidden=true;
    try {
        const requestKey=getOrderRequestKey();
        const requestItems=cart.map(item=>({id:item.id,quantity:item.quantity}));
        acceptedOrder=await postCheckoutJSON("/api/checkout/order",{
            idempotencyKey:requestKey,
            customer:{name:customerDetails.name,phone:phone.normalized,address:customerDetails.address},
            items:requestItems,
            expectedSubtotal:currentQuote.subtotal
        });
        if(!acceptedOrder?.orderId||!Array.isArray(acceptedOrder.items)) throw new Error("The store response did not confirm this order. Retry the same request safely.");
        cart=[];
        saveCart();
        renderCart();
        renderOrderConfirmation(acceptedOrder);
    } catch(error) {
        if(error.data?.quote){
            currentQuote=error.data.quote;
            updateQuotePrices(currentQuote);
            renderOrderReview({...customerDetails,phone:phone.normalized},currentQuote);
        }
        checkoutElement("reviewCheckoutError").textContent=error.message||"We couldn’t confirm whether the order reached the store. Retry this request before changing the order.";
        checkoutElement("reviewCheckoutError").hidden=false;
    } finally {
        orderSubmitting=false;
        button.disabled=false;
        button.textContent="Place order";
    }
}

function finishCheckout() {
    if(orderSubmitting) return;
    customerDetails={name:"",phone:"",address:""};
    acceptedOrder=null;
    currentQuote=null;
    orderRequestKey=null;
    try { sessionStorage.removeItem("vinayakCheckoutRequestKey"); } catch {}
    checkoutElement("customerDetailsForm")?.reset();
    closeCheckoutToCart();
}

checkoutElement("customerDetailsForm")?.addEventListener("submit",continueToReview);
checkoutElement("placeOrderButton")?.addEventListener("click",placeOrder);
document.querySelectorAll("[data-close-checkout],[data-back-to-cart],[data-edit-cart]").forEach(button=>button.addEventListener("click",closeCheckoutToCart));
document.querySelector("[data-edit-details]")?.addEventListener("click",()=>{fillCustomerDetails();showCheckoutStep("details");});
document.querySelector("[data-checkout-done]")?.addEventListener("click",finishCheckout);
checkoutElement("checkoutOverlay")?.addEventListener("click",event=>{if(event.target===event.currentTarget) closeCheckoutToCart();});
[
    ["customerName","customerNameError"],
    ["customerPhone","customerPhoneError"],
    ["customerAddress","customerAddressError"]
].forEach(([inputId,errorId])=>checkoutElement(inputId)?.addEventListener("input",()=>setFieldError(inputId,errorId,"")));

document.addEventListener("keydown",event=>{
    const overlay=checkoutElement("checkoutOverlay");
    if(!overlay||overlay.hidden) return;
    if(event.key==="Escape"){
        event.preventDefault();
        event.stopImmediatePropagation();
        closeCheckoutToCart();
        return;
    }
    if(event.key!=="Tab") return;
    const modal=checkoutElement("checkoutModal");
    const focusable=[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
        .filter(node=>!node.closest("[hidden]")&&node.getClientRects().length);
    if(!focusable.length) return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});

document.addEventListener("products:rendered",()=>{
    if(document.getElementById("cartDrawer")?.classList.contains("show")) renderCart();
});

function showToast(title, message, type = "success") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    const icon = toast.querySelector(".toast-icon");
    toast.classList.toggle("is-error", type === "error");
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    if (icon) icon.textContent = type === "error" ? "!" : "✓";
    document.getElementById("toastTitle").textContent = title;
    document.getElementById("toastMessage").textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2500);
}

updateCartCount();
