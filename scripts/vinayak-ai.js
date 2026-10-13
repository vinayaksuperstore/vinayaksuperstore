/* Vinayak AI storefront interface. Recommendation and conversation rules live in vinayak-ai-engine.js. */
(() => {
    const engine = window.VinayakAIEngine;
    const byId = id => document.getElementById(id);
    const ui = {
        panel: byId("vinayakAi"), launch: byId("vinayakAiLaunch"), close: byId("vinayakAiClose"), fresh: byId("vinayakAiNew"),
        messages: byId("vinayakAiMessages"), form: byId("vinayakAiForm"), input: byId("vinayakAiInput"), suggestions: byId("vinayakAiSuggestions")
    };
    if (!engine || Object.values(ui).some(value => !value)) return;

    const STORAGE_KEY = "vinayakAiConversationV2";
    const FALLBACK_IMAGE = "assets/images/placeholder.svg";
    const formatPrice = paise => engine.formatMoney(paise);
    let catalogCache = null;
    let state = loadState();
    let queue = Promise.resolve();
    let conversationEpoch = 0;
    let launcherFocus = null;

    function loadState() {
        try { return engine.sanitizeState(JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null")); }
        catch { return engine.createState(); }
    }

    function persistState() {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch { /* The conversation still works when browser storage is unavailable. */ }
    }

    function nearBottom() {
        return ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight < 100;
    }

    function appendMessageElement(record, shouldScroll = true) {
        const bubble = document.createElement("article");
        bubble.className = `vinayak-ai__message vinayak-ai__message--${record.role || "assistant"}${record.error ? " vinayak-ai__message--error" : ""}`;
        if (record.role === "user") bubble.setAttribute("aria-label", "You said");
        else bubble.setAttribute("aria-label", "Vinayak AI response");
        const copy = document.createElement("p");
        copy.className = "vinayak-ai__message-copy";
        copy.textContent = String(record.text || "");
        bubble.append(copy);

        const cards = Array.isArray(record.productIds) ? record.productIds.map(id => ({
            product: findProduct(id),
            quantity: record.basket?.find(line => String(line.productId) === String(id))?.quantity || 1,
            reason: record.reasons?.find(line => String(line.productId) === String(id))?.reason || "From the current catalogue."
        })).filter(card => card.product) : [];
        if (cards.length) {
            const list = document.createElement("div");
            list.className = "vinayak-ai__product-list";
            cards.forEach(card => list.append(createProductCard(card, Boolean(record.basket))));
            bubble.append(list);
        }
        if (Array.isArray(record.basket) && record.basket.length && catalogCache) bubble.append(createBasketSummary(record.basket));
        if (record.error) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "vinayak-ai__retry";
            retry.dataset.aiAction = "retry-catalog";
            retry.textContent = "Retry catalogue";
            bubble.append(retry);
        }
        ui.messages.append(bubble);
        if (shouldScroll && nearBottom()) ui.messages.scrollTop = ui.messages.scrollHeight;
        return bubble;
    }

    function findProduct(id) {
        return Array.isArray(catalogCache) ? catalogCache.find(product => String(product.id) === String(id)) : null;
    }

    function createProductCard(card, isBasket) {
        const product = card.product;
        const section = document.createElement("section");
        section.className = "vinayak-ai__product";
        const image = document.createElement("img");
        image.src = product.image || FALLBACK_IMAGE;
        image.alt = "";
        image.loading = "lazy";
        image.onerror = () => { image.onerror = null; image.src = FALLBACK_IMAGE; };
        section.append(image);

        const body = document.createElement("div");
        body.className = "vinayak-ai__product-body";
        const title = document.createElement("h3");
        title.textContent = product.name || "Store product";
        const price = document.createElement("strong");
        price.className = "vinayak-ai__product-price";
        price.textContent = formatPrice(engine.pricePaise(product));
        const reason = document.createElement("small");
        reason.className = "vinayak-ai__product-reason";
        reason.textContent = card.reason || product.subcategory || product.category || "Current store price";
        body.append(title, price, reason);

        const controls = document.createElement("div");
        controls.className = "vinayak-ai__product-controls";
        if (isBasket) {
            const decrease = document.createElement("button");
            decrease.type = "button";
            decrease.dataset.aiAction = "quantity-down";
            decrease.dataset.productId = product.id;
            decrease.setAttribute("aria-label", `Decrease proposed quantity for ${product.name}`);
            decrease.textContent = "−";
            const quantity = document.createElement("span");
            quantity.className = "vinayak-ai__qty";
            quantity.dataset.quantityFor = product.id;
            quantity.setAttribute("aria-live", "polite");
            quantity.textContent = String(card.quantity || 1);
            const increase = document.createElement("button");
            increase.type = "button";
            increase.dataset.aiAction = "quantity-up";
            increase.dataset.productId = product.id;
            increase.setAttribute("aria-label", `Increase proposed quantity for ${product.name}`);
            increase.textContent = "+";
            controls.append(decrease, quantity, increase);
        }
        const view = document.createElement("button");
        view.type = "button";
        view.dataset.aiAction = "view-product";
        view.dataset.productId = product.id;
        view.textContent = "View details";
        const add = document.createElement("button");
        add.type = "button";
        add.className = "vinayak-ai__add";
        add.dataset.aiAction = "add-to-cart";
        add.dataset.productId = product.id;
        add.dataset.quantity = String(card.quantity || 1);
        add.textContent = `Add ${card.quantity > 1 ? `${card.quantity} × ` : ""}to cart`;
        controls.append(view, add);
        body.append(controls);
        section.append(body);
        return section;
    }

    function createBasketSummary(lines) {
        const summary = document.createElement("div");
        summary.className = "vinayak-ai__basket-summary";
        summary.dataset.basketSummary = "true";
        const totals = engine.basketTotals(lines, catalogCache, currentBudget());
        const itemCount = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        const label = document.createElement("span");
        label.textContent = `Proposed basket · ${itemCount} ${itemCount === 1 ? "item" : "items"}`;
        const total = document.createElement("strong");
        total.textContent = formatPrice(totals.totalPaise);
        summary.append(label, total);
        if (totals.remainingPaise !== null) {
            const remainingLabel = document.createElement("span");
            remainingLabel.textContent = "Remaining budget";
            const remaining = document.createElement("strong");
            remaining.textContent = formatPrice(totals.remainingPaise);
            summary.append(remainingLabel, remaining);
            const track = document.createElement("div");
            track.className = "vinayak-ai__budget-track";
            track.setAttribute("role", "progressbar");
            track.setAttribute("aria-label", "Proposed basket budget used");
            const fill = document.createElement("span");
            const budget = currentBudget();
            fill.style.width = `${budget > 0 ? Math.min(100, totals.totalPaise / budget * 100) : 0}%`;
            track.append(fill);
            summary.append(track);
        }
        return summary;
    }

    function currentBudget() {
        const request = state.request;
        if (request.budget.scope === "per-item") return null;
        if (request.budget.scope === "per-person") return request.people ? request.budget.amountPaise * request.people : null;
        return request.budget.amountPaise;
    }

    function appendLiveAssistant(text, options = {}) {
        const row = { role: "assistant", text, productIds: options.productIds || [], basket: options.basket || null, error: Boolean(options.error) };
        if (options.reasons) row.reasons = options.reasons;
        state.history.push(row);
        state.history = state.history.slice(-60);
        persistState();
        const bubble = appendMessageElement(row);
        return bubble;
    }

    function renderHistory() {
        ui.messages.replaceChildren();
        for (const record of state.history) appendMessageElement(record, false);
        ui.messages.scrollTop = ui.messages.scrollHeight;
        renderSuggestions(engine.suggestedPrompts(state.request, catalogCache || []));
    }

    function renderSuggestions(suggestions) {
        ui.suggestions.replaceChildren();
        (suggestions || []).forEach(([label, prompt]) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.aiPrompt = prompt;
            button.textContent = label;
            ui.suggestions.append(button);
        });
    }

    async function loadCatalog(force = false) {
        if (!force && catalogCache?.length) return catalogCache;
        if (!force && window.productsReady) {
            try {
                const current = await window.productsReady;
                if (Array.isArray(current) && current.length) {
                    catalogCache = current;
                    return catalogCache;
                }
            } catch { /* Retry once through the catalogue endpoint below. */ }
        }
        const response = await fetch("/api/products", { cache: "no-store" });
        if (!response.ok) throw new Error("The store catalogue could not be reached.");
        const records = await response.json();
        if (!Array.isArray(records) || !records.length || records.some(item => !item || item.id === undefined || !item.name || !item.category)) {
            throw new Error("The store catalogue returned incomplete product data.");
        }
        catalogCache = records;
        if (typeof products !== "undefined" && products !== catalogCache) {
            products.splice(0, products.length, ...records);
            if (typeof refreshCatalogViews === "function") refreshCatalogViews();
        }
        return catalogCache;
    }

    function showTyping() {
        const bubble = document.createElement("div");
        bubble.id = "vinayakAiTyping";
        bubble.className = "vinayak-ai__message";
        bubble.setAttribute("role", "status");
        bubble.setAttribute("aria-label", "Vinayak AI is working");
        bubble.innerHTML = '<span class="vinayak-ai__typing" aria-hidden="true"><i></i><i></i><i></i></span>';
        ui.messages.append(bubble);
        ui.messages.scrollTop = ui.messages.scrollHeight;
    }

    function openAssistant() {
        launcherFocus = document.activeElement;
        ui.panel.classList.add("is-open");
        ui.panel.setAttribute("aria-hidden", "false");
        ui.launch.setAttribute("aria-expanded", "true");
        ui.input.focus();
        ui.messages.scrollTop = ui.messages.scrollHeight;
    }

    function closeAssistant() {
        ui.panel.classList.remove("is-open");
        ui.panel.setAttribute("aria-hidden", "true");
        ui.launch.setAttribute("aria-expanded", "false");
        (launcherFocus && typeof launcherFocus.focus === "function" ? launcherFocus : ui.launch).focus();
    }

    function startNewConversation() {
        conversationEpoch += 1;
        state = engine.newConversation();
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
        const greeting = { role: "assistant", text: "Hi! Tell me what you’re shopping for and, if you like, your budget or occasion." };
        state.history.push(greeting);
        renderHistory();
        persistState();
        ui.input.focus();
    }

    function addFailureRecord(text, response) {
        state.history.push({ role: "user", text });
        state.history.push({ role: "assistant", text: response, error: true });
        state.history = state.history.slice(-60);
        persistState();
    }

    async function handleSend(raw, epoch) {
        if (epoch !== conversationEpoch) return;
        const text = String(raw || "").trim();
        if (!text) return;
        appendMessageElement({ role: "user", text });
        ui.form.querySelector("button[type=submit]").disabled = true;
        showTyping();
        try {
            const catalog = await loadCatalog();
            if (epoch !== conversationEpoch) return;
            state.cartContext = typeof cart !== "undefined" && Array.isArray(cart) ? cart.map(item => ({ productId: item.id, quantity: item.quantity })) : [];
            const result = engine.processMessage(state, text, catalog);
            state = result.state;
            const row = state.history[state.history.length - 1];
            if (row && row.role === "assistant") {
                row.reasons = (result.response.productCards || []).map(card => ({ productId: card.product.id, reason: card.reason }));
            }
            persistState();
            if (result.accepted) {
                appendMessageElement(row || { role: "assistant", text: result.response.text, productIds: [] });
                if (result.response.basket && row) row.basket = state.request.proposedBasket;
            } else {
                appendMessageElement({ role: "assistant", text: result.response.text });
            }
            renderSuggestions(result.response.suggestions || []);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "The current product catalogue is unavailable.";
            const reply = `${detail} I haven’t changed your shopping plan. Check your connection and retry the catalogue.`;
            addFailureRecord(text, reply);
            appendMessageElement({ role: "assistant", text: reply, error: true });
            renderSuggestions([["Retry catalogue", "__retry_catalog__"]]);
        } finally {
            byId("vinayakAiTyping")?.remove();
            ui.form.querySelector("button[type=submit]").disabled = false;
        }
    }

    function send(raw) {
        const text = String(raw || "").trim();
        if (!text) return;
        ui.input.value = "";
        const epoch = conversationEpoch;
        queue = queue.then(() => handleSend(text, epoch)).catch(() => {});
    }

    function updateDisplayedQuantities(productId, quantity) {
        const summaries = [...ui.messages.querySelectorAll("[data-basket-summary]")];
        const currentBasketMessage = summaries.at(-1)?.closest(".vinayak-ai__message");
        if (!currentBasketMessage) return;
        currentBasketMessage.querySelectorAll(`[data-quantity-for="${CSS.escape(String(productId))}"]`).forEach(node => { node.textContent = String(quantity); });
        currentBasketMessage.querySelectorAll(`[data-product-id="${CSS.escape(String(productId))}"][data-ai-action="add-to-cart"]`).forEach(button => {
            button.dataset.quantity = String(quantity);
            button.textContent = `Add ${quantity > 1 ? `${quantity} × ` : ""}to cart`;
        });
        const lines = state.request.proposedBasket;
        const summary = currentBasketMessage.querySelector("[data-basket-summary]");
        if (summary) summary.replaceWith(createBasketSummary(lines));
    }

    async function handleAction(button) {
        const action = button.dataset.aiAction;
        const productId = button.dataset.productId;
        if (action === "retry-catalog") {
            try {
                await loadCatalog(true);
                const ready = "The catalogue is ready. Your previous shopping plan is unchanged—send that request again when you’re ready.";
                appendLiveAssistant(ready);
                renderSuggestions(engine.suggestedPrompts(state.request, catalogCache));
            } catch (error) {
                const retryText = error instanceof Error ? error.message : "The catalogue is still unavailable.";
                appendLiveAssistant(`${retryText} I haven’t changed your shopping plan.`, { error: true });
            }
            return;
        }
        if (action === "view-product") {
            if (typeof window.openProduct === "function") {
                closeAssistant();
                window.openProduct(Number(productId));
            }
            return;
        }
        if (action === "quantity-up" || action === "quantity-down") {
            const current = state.request.proposedBasket.find(line => String(line.productId) === String(productId));
            if (!current) return;
            const change = action === "quantity-up" ? 1 : -1;
            const updated = engine.updateQuantity(state, productId, Math.max(1, current.quantity + change), catalogCache);
            if (!updated.changed) {
                if (updated.reason === "budget") appendLiveAssistant("That quantity would take the proposed basket over your budget, so I left it unchanged.");
                return;
            }
            state = updated.state;
            persistState();
            updateDisplayedQuantities(productId, current.quantity + change);
            return;
        }
        if (action === "add-to-cart") {
            const product = findProduct(productId);
            const quantity = Math.max(1, Math.min(99, Number(button.dataset.quantity) || 1));
            if (!product || typeof window.addToCart !== "function") {
                appendLiveAssistant("I can’t reach the store cart right now, so nothing was added.", { error: true });
                return;
            }
            button.disabled = true;
            button.textContent = "Checking price…";
            try {
                const added = await window.addToCart(product.id, quantity);
                if (!added) throw new Error("The store could not verify this product and quantity, so it wasn’t added.");
                state.cartContext = typeof cart !== "undefined" && Array.isArray(cart) ? cart.map(item => ({ productId: item.id, quantity: item.quantity })) : state.cartContext;
                persistState();
                appendLiveAssistant(`Added ${quantity} × ${product.name} to your store cart using the store’s verified price. The proposed basket remains separate.`);
            } catch (error) {
                appendLiveAssistant(error instanceof Error ? error.message : "The product wasn’t added to your cart.", { error: true });
            } finally {
                button.disabled = false;
                button.textContent = `Add ${quantity > 1 ? `${quantity} × ` : ""}to cart`;
            }
        }
    }

    ui.launch.addEventListener("click", openAssistant);
    ui.close.addEventListener("click", closeAssistant);
    ui.fresh.addEventListener("click", startNewConversation);
    ui.form.addEventListener("submit", event => { event.preventDefault(); send(ui.input.value); });
    ui.suggestions.addEventListener("click", event => {
        const button = event.target.closest("button[data-ai-prompt]");
        if (!button) return;
        if (button.dataset.aiPrompt === "__retry_catalog__") {
            const retry = ui.messages.querySelector("[data-ai-action='retry-catalog']");
            if (retry) handleAction(retry);
            else loadCatalog(true).then(() => appendLiveAssistant("The catalogue is ready. Your plan is unchanged.")).catch(() => appendLiveAssistant("The catalogue is still unavailable. Nothing in your plan or cart changed.", { error: true }));
            return;
        }
        send(button.dataset.aiPrompt);
    });
    ui.messages.addEventListener("click", event => {
        const button = event.target.closest("button[data-ai-action]");
        if (button) handleAction(button);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && ui.panel.classList.contains("is-open")) {
            event.stopPropagation();
            closeAssistant();
        }
    });

    if (!state.history.length) {
        state.history.push({ role: "assistant", text: "Hi! Tell me what you’re shopping for and, if you like, your budget or occasion." });
        persistState();
    }
    renderSuggestions(engine.suggestedPrompts(state.request, []));
    renderHistory();
    loadCatalog().then(() => {
        renderHistory();
    }).catch(() => {
        if (!state.history.some(row => row.error)) {
            appendLiveAssistant("I’m having trouble loading the store catalogue. Your cart and shopping plan are untouched; retry when the connection is back.", { error: true });
            renderSuggestions([["Retry catalogue", "__retry_catalog__"]]);
        }
    });
})();
