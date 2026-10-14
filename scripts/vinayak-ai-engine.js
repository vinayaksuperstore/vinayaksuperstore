/*
 * Vee's deterministic conversation and catalogue engine.
 * State contains only this tab's shopping conversation and proposed basket.
 * The store cart is deliberately handled by the separate, explicit cart UI.
 */
(function (root, factory) {
    const engine = factory();
    if (typeof module === "object" && module.exports) module.exports = engine;
    if (root) root.VinayakAIEngine = engine;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
    "use strict";

    const VERSION = 2;
    const MAX_MESSAGE_LENGTH = 400;
    const MAX_HISTORY = 60;
    const MAX_LINES = 8;
    const MAX_BUDGET_PAISE = 100_000_000;
    const STOP_WORDS = new Set(["a", "about", "all", "an", "and", "are", "as", "at", "buy", "can", "for", "from", "get", "give", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "product", "products", "some", "something", "the", "this", "to", "want", "what", "with"]);
    const CATEGORY_ALIASES = {
        snacks: ["snack", "snacks", "snack mix", "crunchy snacks"],
        drinks: ["drinks", "beverages", "cold drinks", "soft drinks"],
        sweets: ["sweets", "candy", "candies", "desserts"],
        breakfast: ["breakfast"],
        grocery: ["groceries", "essentials"]
    };
    const CATEGORY_SYNONYMS = {
        chips: "Snacks", crisps: "Snacks", namkeen: "Namkeen", biscuit: "Biscuits", biscuits: "Biscuits",
        cookie: "Biscuits", cookies: "Biscuits", chocolate: "Chocolates", chocolates: "Chocolates",
        candy: "Chocolates", candies: "Chocolates", juice: "Beverages", soda: "Beverages",
        coffee: "Coffee", tea: "Tea", energy: "Energy Drinks"
    };
    const CATEGORY_HINTS = {
        snacks: ["snack", "namkeen", "biscuit", "healthy snack"],
        drinks: ["beverage", "energy drink", "drink"],
        sweets: ["chocolate", "bakery", "candy"],
        breakfast: ["breakfast", "coffee", "tea", "spread"],
        grocery: ["grocery", "instant food", "sauce", "household"]
    };
    const OCCASIONS = [
        ["movie night", "movie night"], ["birthday", "birthday"], ["house party", "house party"],
        ["party", "party"], ["family gathering", "family gathering"], ["gathering", "family gathering"],
        ["festival", "festival"], ["festive", "festival"], ["gift", "gifting"], ["gifting", "gifting"],
        ["picnic", "picnic"], ["trip", "travel"], ["travel", "travel"]
    ];
    const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const NUT_TERMS = ["nut", "nuts", "peanut", "peanuts", "almond", "almonds", "hazelnut", "hazelnuts", "cashew", "cashews", "pistachio", "pistachios", "walnut", "walnuts"];
    const SPICY_TERMS = ["spicy", "hot", "chilli", "chili", "masala", "peri peri"];

    function emptyRequest() {
        return {
            intent: null,
            mode: null,
            taskId: null,
            preferences: { mix: false, importedOnly: false, priceStyle: null, audience: null, focusCategories: [] },
            budget: { amountPaise: null, currency: "INR", scope: "basket" },
            categories: [],
            occasion: null,
            people: null,
            requestedQuantity: 1,
            itemTarget: 5,
            dietary: { restrictions: [], required: [] },
            excludedCategories: [],
            excludedProductIds: [],
            protectedProductIds: [],
            replaceProductIds: [],
            replacementCategories: [],
            quantities: {},
            proposedBasket: [],
            recommendedIds: [],
            resultIds: [],
            resultOffset: 0,
            lastQuestion: null,
            unresolvedConstraints: [],
            lastOperation: null,
            recalculationCount: 0
        };
    }

    function createState() {
        return { version: VERSION, sessionId: makeId(), request: emptyRequest(), history: [], cartContext: null };
    }

    function makeId() {
        try { return globalThis.crypto?.randomUUID?.() || `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
        catch { return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    }

    function sanitizeState(input) {
        const fresh = createState();
        if (!input || typeof input !== "object" || input.version !== VERSION) return fresh;
        const request = input.request && typeof input.request === "object" ? input.request : {};
        const base = emptyRequest();
        Object.keys(base).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(request, key)) base[key] = request[key];
        });
        base.preferences = { ...emptyRequest().preferences, ...(request.preferences || {}), focusCategories: Array.isArray(request.preferences?.focusCategories) ? [...request.preferences.focusCategories] : [] };
        base.budget = { ...emptyRequest().budget, ...(request.budget || {}) };
        base.dietary = { restrictions: [...new Set(request.dietary?.restrictions || [])], required: [...new Set(request.dietary?.required || [])] };
        ["categories", "excludedCategories", "excludedProductIds", "protectedProductIds", "replaceProductIds", "replacementCategories", "recommendedIds", "resultIds", "unresolvedConstraints"]
            .forEach(key => { base[key] = Array.isArray(base[key]) ? [...base[key]] : []; });
        base.quantities = base.quantities && typeof base.quantities === "object" ? { ...base.quantities } : {};
        base.proposedBasket = Array.isArray(base.proposedBasket) ? base.proposedBasket.map(line => ({ ...line })) : [];
        const history = Array.isArray(input.history) ? input.history.slice(-MAX_HISTORY).filter(row => row && ["user", "assistant"].includes(row.role) && typeof row.text === "string").map(row => ({ ...row, productIds: Array.isArray(row.productIds) ? [...row.productIds] : row.productIds })) : [];
        const cartContext = Array.isArray(input.cartContext) ? input.cartContext.map(item => ({ ...item })) : null;
        return { version: VERSION, sessionId: typeof input.sessionId === "string" ? input.sessionId : fresh.sessionId, request: base, history, cartContext };
    }

    function normalizeText(value) {
        return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}₹.\s-]/gu, " ").replace(/\s+/g, " ").trim();
    }

    function categoryNames(catalog) {
        return [...new Set((catalog || []).map(product => product && String(product.category || "").trim()).filter(Boolean))];
    }

    function includesPhrase(text, phrase) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        return new RegExp(`(^|\\b)${escaped}(?=$|\\b)`, "i").test(text);
    }

    function matchingCategories(alias, catalog) {
        const categories = categoryNames(catalog);
        const lowered = alias.toLowerCase();
        if (lowered === "party" || lowered === "gifting") {
            const names = lowered === "party"
                ? [...(CATEGORY_HINTS.snacks || []), ...(CATEGORY_HINTS.drinks || []), ...(CATEGORY_HINTS.sweets || [])]
                : ["chocolate", "bakery", "fragrance"];
            return categories.filter(category => names.some(hint => category.toLowerCase().includes(hint)));
        }
        const hints = CATEGORY_HINTS[lowered];
        if (hints) return categories.filter(category => hints.some(hint => category.toLowerCase().includes(hint)));
        return categories.filter(category => {
            const normalized = category.toLowerCase();
            return normalized === lowered || normalized.includes(lowered) || lowered.includes(normalized);
        });
    }

    function categoriesMentioned(text, catalog) {
        const names = categoryNames(catalog).sort((a, b) => b.length - a.length);
        const found = new Set();
        for (const category of names) {
            if (category.toLowerCase() === "imported" && includesPhrase(text, "imported") && !includesPhrase(text, "imported category")) continue;
            if (includesPhrase(text, category.toLowerCase())) found.add(category);
        }
        for (const [group, aliases] of Object.entries(CATEGORY_ALIASES)) {
            const broadMatch = aliases.some(alias => includesPhrase(text, alias));
            const specificSnack = group === "snacks" && /\b(healthy snacks?|namkeen|biscuits?|cookies?)\b/.test(text) && !/\bparty snacks?|snack mix\b/.test(text);
            const specificDrink = group === "drinks" && /\benergy drinks?\b/.test(text) && !/\b(cold|soft) drinks?\b/.test(text);
            if (broadMatch && !specificSnack && !specificDrink) matchingCategories(group, catalog).forEach(category => found.add(category));
        }
        for (const [alias, category] of Object.entries(CATEGORY_SYNONYMS)) {
            if (!includesPhrase(text, alias)) continue;
            const actual = names.find(name => name.toLowerCase() === category.toLowerCase());
            if (actual) found.add(actual);
        }
        return [...found];
    }

    function detectOccasion(text) {
        const match = OCCASIONS.find(([phrase]) => includesPhrase(text, phrase));
        return match ? match[1] : null;
    }

    function parseAmount(text, allowBare = false) {
        if (allowBare && /^-?\d[\d,]*(?:\.\d{1,2})?$/.test(text)) {
            const value = Number(text.replace(/,/g, ""));
            if (!Number.isFinite(value) || value < 0) return { error: "negative" };
            if (value > MAX_BUDGET_PAISE / 100) return { error: "too-large" };
            return { valuePaise: Math.round(value * 100), value };
        }
        const actionAmount = text.match(/\b(?:increase|raise|add|reduce|decrease)\s+(?:(?:my\s+)?budget\s+)?(?:by\s+)?(?:₹|rs\.?\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)\s+(?:to|from|by)\b/i)
            || text.match(/\b(?:add|increase|raise|reduce|decrease)\s+(?:₹|rs\.?\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)\s+(?:to|by)\b/i);
        if (actionAmount) {
            const value = Number(actionAmount[1].replace(/,/g, ""));
            if (!Number.isFinite(value) || value < 0) return { error: "negative" };
            if (value > MAX_BUDGET_PAISE / 100) return { error: "too-large" };
            return { valuePaise: Math.round(value * 100), value };
        }
        const cue = /(?:₹|\brs\.?\s*|\binr\s*)(-?\d[\d,]*(?:\.\d{1,2})?)|(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:rupees?|rs\.?|₹)|\b(-?\d[\d,]*(?:\.\d{1,2})?)\s+less\b|\b(?:under|below|within|budget(?:\s+of)?|spend|increase(?:\s+my)?\s+budget(?:\s+by)?|raise(?:\s+my)?\s+budget(?:\s+by)?|add\s+to\s+(?:my\s+)?budget|reduce(?:\s+my)?\s+budget(?:\s+by)?|decrease(?:\s+my)?\s+budget(?:\s+by)?)\s*(?:of\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)/i;
        const match = text.match(cue);
        if (!match) return null;
        const raw = (match[1] || match[2] || match[3] || match[4] || "").replace(/,/g, "");
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return { error: "negative" };
        if (value > MAX_BUDGET_PAISE / 100) return { error: "too-large" };
        return { valuePaise: Math.round(value * 100), value };
    }

    function budgetScope(text) {
        if (/\bper\s+person\b|\beach\s+person\b/.test(text)) return "per-person";
        if (/\bper\s+item\b|\beach\s+item\b/.test(text)) return "per-item";
        return null;
    }

    function detectPeople(text) {
        const match = text.match(/\b(?:for|about|around)\s*(\d{1,3})\s*(?:people|persons|guests|friends|kids|children)?\b|\b(\d{1,3})\s*(?:people|persons|guests|friends|kids|children)\b/);
        if (!match) return null;
        const value = Number(match[1] || match[2]);
        return value > 0 && value <= 500 ? value : null;
    }

    function detectQuantity(text) {
        let match = text.match(/\b(?:add|need|want|make it|take)\s+(\d{1,2})\s*(?:more|extra)?\s*(?:items?|packs?|pieces?|of them)?\b|\b(\d{1,2})\s*(?:packs?|pieces?|items?)\b/);
        if (match) return { value: Math.max(1, Math.min(99, Number(match[1] || match[2]))), more: /\bmore\b/.test(text) };
        match = text.match(/\b(?:add|need|want|take)\s+(one|two|three|four|five)\b/);
        if (match) return { value: NUMBER_WORDS[match[1]], more: /\bmore\b/.test(text) };
        return null;
    }

    function isModifier(text) {
        return /\b(add|include|mix|remove|replace|change|keep|more|another|cheaper|premium|budget|increase|raise|reduce|decrease|under|same|without|no\s+|only|for\s+\d|start fresh|new request|show|find|compare|instead|different)\b/.test(text);
    }

    function classifyIntent(text, request, catalog) {
        const reset = /\b(start fresh|start a new request|start new|new conversation|new request|start over|reset|forget this plan)\b/.test(text);
        if (reset) return { type: "reset" };
        if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text)) return { type: "greeting" };
        if (/\b(help|what can you do|how does this work)\b/.test(text)) return { type: "help" };
        if (/\b(compare|versus|\bvs\b|difference between)\b/.test(text)) return { type: "comparison" };
        if (/\b(cart|checkout|order)\b/.test(text)) return { type: "cart-query" };
        if (/^more$/.test(text) || /\b(show more|more options|anything else|show another|another option|something different|not those|different options)\b/.test(text)) return { type: "alternatives" };
        if (/\b(what is|what's|tell me about|how much|price of|cost of)\b/.test(text)) return { type: "attribute-question" };
        if (/\b(what products|what.*available|categories)\b/.test(text)) return { type: "category-browse" };
        if (request.lastQuestion?.expectedType === "budget" && /^-?\d[\d,]*(?:\.\d{1,2})?$/.test(text)) return { type: "budget-change" };
        if (parseAmount(text) && (/\b(increase|raise|reduce|decrease|less|under|below|within|budget|spend|add)\b/.test(text) || /₹|\brs\b|\binr\b/.test(text))) return { type: "budget-change" };
        if (/\b(increase|raise|reduce|decrease)\b.*\bbudget\b/.test(text)) return { type: "budget-change" };
        const mentioned = categoriesMentioned(text, catalog);
        const hasActiveTask = Boolean(request.intent || request.mode || request.categories.length || request.occasion || request.budget.amountPaise !== null);
        if (hasActiveTask && mentioned.length && !isModifier(text)) {
            const current = new Set(request.categories);
            if (!mentioned.some(category => current.has(category))) return { type: "new-task", categories: mentioned };
        }
        if (/\b(make it cheaper|cheaper|lower price|less expensive)\b/.test(text)) return { type: "cheaper" };
        if (/\b(premium|higher end|luxury|best quality)\b/.test(text)) return { type: "premium" };
        if (/\b(mix|variety|varied|more chocolate[- ]heavy|heavier on chocolates)\b/.test(text)) return { type: "mix" };
        if (/\bremove\b/.test(text)) return { type: "remove" };
        if (/\b(keep .+\b(?:replace|change)|replace .+ with|change .+ to)\b/.test(text)) return { type: "partial-replace" };
        if (/\b(yes|yeah|yep|sure|okay|ok)\b/.test(text) && text.split(" ").length <= 3) return { type: "yes" };
        if (/\b(no|nope|nah)\b/.test(text) && text.split(" ").length <= 4) return { type: "no" };
        if (/\b(forget|ignore)\b.*\b(that|previous)\b/.test(text)) return { type: "reset" };
        if (/\b(recommend|suggest|plan|build|make|put together|need|looking for|find|show me|i want|i need|give me|browse|under|budget)\b/.test(text) || mentioned.length || detectOccasion(text)) return { type: "shopping-request", categories: mentioned };
        if (request.intent || request.mode) return { type: "follow-up" };
        return { type: "unclear" };
    }

    function startTask(request, preserveHistoryState) {
        const fresh = emptyRequest();
        fresh.taskId = makeId();
        if (preserveHistoryState) Object.assign(request, fresh);
        return request;
    }

    function productText(product) {
        return normalizeText([product?.name, product?.brand, product?.category, product?.subcategory, product?.description, product?.badge, ...(Array.isArray(product?.keywords) ? product.keywords : []), ...(Array.isArray(product?.tags) ? product.tags : [])].filter(Boolean).join(" "));
    }

    function groupCategories(group, catalog) {
        return matchingCategories(group, catalog);
    }

    function mentionsDiet(text, request) {
        if (/\b(?:no|without|avoid|exclude|free from|allergic to)\s+(?:any\s+)?(?:spicy|spice|chilli|chili|hot)\b/.test(text)) addUnique(request.dietary.restrictions, "spicy");
        if (/\b(?:no|without|avoid|exclude|free from|allergic to)\s+(?:any\s+)?(?:nuts?|peanuts?|almonds?|hazelnuts?|cashews?|pistachios?)\b/.test(text)) addUnique(request.dietary.restrictions, "nuts");
        if (/\b(?:no|without|avoid|exclude|free from)\s+sugar\b/.test(text)) addUnique(request.dietary.restrictions, "sugar");
        if (/\bvegetarian\b/.test(text)) addUnique(request.dietary.required, "vegetarian");
        if (/\bvegan\b/.test(text)) addUnique(request.dietary.required, "vegan");
    }

    function addUnique(list, value) { if (!list.includes(value)) list.push(value); }

    function updateRequest(request, intent, text, catalog) {
        const categories = intent.categories || categoriesMentioned(text, catalog);
        const active = Boolean(request.intent || request.mode || request.categories.length || request.occasion);
        const addition = /\b(add|include|plus|also|more|heavier|heavy|keep|replace|change)\b/.test(text);
        if (intent.type === "new-task") {
            startTask(request, true);
            request.categories = [...intent.categories];
            request.intent = "product-discovery";
            request.mode = "recommendation";
        } else if (intent.type === "shopping-request" && !active) {
            startTask(request, true);
            request.categories = categories;
            request.intent = "product-discovery";
            request.mode = "recommendation";
        } else if (categories.length) {
            if (!active || !request.categories.length || addition) categories.forEach(category => addUnique(request.categories, category));
            else if (/\b(instead|switch to|change to|only)\b/.test(text)) request.categories = categories;
        }

        const occasion = detectOccasion(text);
        if (occasion) { request.occasion = occasion; request.intent = "occasion-shopping"; request.mode = "basket"; }
        if (/\b(party|basket|bundle|mix|movie night|birthday|gathering|picnic)\b/.test(text) && request.intent) request.mode = "basket";
        if (intent.type === "mix") { request.preferences.mix = true; request.mode = "basket"; if (!request.intent) request.intent = "product-recommendation"; }

        if (/\bimported\b/.test(text)) request.preferences.importedOnly = !/\b(not imported|non[- ]imported|local only)\b/.test(text);
        if (/\b(local only|non[- ]imported|not imported)\b/.test(text)) request.preferences.importedOnly = false;
        if (/\b(for kids|for children|kids?\s+(?:party|snacks|treats))\b/.test(text)) request.preferences.audience = "kids";
        if (/\bfor adults\b/.test(text)) request.preferences.audience = "adults";
        if (intent.type === "cheaper") request.preferences.priceStyle = "cheaper";
        if (intent.type === "premium") request.preferences.priceStyle = "premium";
        if (/\b(same|keep)\b/.test(text) && !/\b(cheaper|premium)\b/.test(text)) { /* keep existing constraints */ }
        mentionsDiet(text, request);

        const people = detectPeople(text);
        if (people !== null) request.people = people;
        const quantity = detectQuantity(text);
        if (quantity) {
            if (quantity.more) request.itemTarget = Math.min(MAX_LINES, Math.max(request.proposedBasket.length, request.itemTarget) + quantity.value);
            else request.requestedQuantity = quantity.value;
            request.mode = "basket";
        }
        if (/\bmore chocolate[- ]heavy\b|\bheavier on chocolates\b/.test(text)) {
            request.preferences.focusCategories = groupCategories("sweets", catalog);
            request.preferences.mix = true;
            request.mode = "basket";
        }
        if (/\badd more chocolates?\b/.test(text)) {
            groupCategories("sweets", catalog).forEach(category => addUnique(request.categories, category));
            request.preferences.focusCategories = groupCategories("sweets", catalog);
            request.preferences.mix = true;
            request.mode = "basket";
        }

        const budget = parseAmount(text, request.lastQuestion?.expectedType === "budget");
        const scope = budgetScope(text);
        if (budget?.error) return { budgetError: budget.error };
        if (budget) {
            const relativeIncrease = /\b(increase|raise|add)\b/.test(text) && /\b(by|to|budget)\b/.test(text);
            const relativeDecrease = /\b(reduce|decrease|less)\b/.test(text) && /\b(by|less|budget)\b/.test(text);
            if ((relativeIncrease || relativeDecrease) && request.budget.amountPaise === null) return { budgetNeedsBase: true };
            if (relativeIncrease) request.budget.amountPaise = Math.min(MAX_BUDGET_PAISE, request.budget.amountPaise + budget.valuePaise);
            else if (relativeDecrease) request.budget.amountPaise = Math.max(0, request.budget.amountPaise - budget.valuePaise);
            else request.budget.amountPaise = budget.valuePaise;
            if (scope) request.budget.scope = scope;
            request.mode = "basket";
            if (!request.intent) request.intent = "budget-shopping";
        }

        const removeMention = intent.type === "remove";
        if (removeMention) {
            const removeCategories = categories.length ? categories : categoriesMentioned(text.replace(/\bremove\b/, ""), catalog);
            if (removeCategories.length) {
                const before = [...request.categories];
                request.categories = request.categories.filter(category => !removeCategories.includes(category));
                removeCategories.forEach(category => addUnique(request.excludedCategories, category));
                if (!request.categories.length && before.length) request.mode = "recommendation";
            } else if (/\bdrinks?\b/.test(text)) groupCategories("drinks", catalog).forEach(category => addUnique(request.excludedCategories, category));
        }

        const restrictions = request.dietary.restrictions;
        if (restrictions.includes("spicy")) groupCategories("snacks", catalog).forEach(category => { /* exclusions are checked from catalog text */ void category; });
        if (/\bunder\b|\bbudget\b|\bspend\b|₹|\brs\b/.test(text) && request.mode !== "basket") request.mode = "basket";
        if (!request.taskId && request.intent) request.taskId = makeId();
        if ((active || request.intent) && request.lastOperation !== "partial-replacement") request.lastOperation = "constraints-updated";
        return { budgetError: null };
    }

    function categoryPhrase(text, categories) {
        return categories.find(category => includesPhrase(text, category.toLowerCase())) || null;
    }

    function handlePartialReplacement(request, text, catalog) {
        if (!/\bkeep .+\b(?:replace|change)\b/.test(text)) return false;
        const keep = text.match(/\bkeep\s+(?:the\s+)?(.+?)\s+(?:(?:but|and)\s+)?(?:replace|change)\b/);
        const replace = text.match(/\b(?:replace|change)\s+(?:the\s+)?(.+?)(?:\s+with\b|\s*$)/);
        const keepCategories = keep ? categoriesMentioned(keep[1], catalog) : [];
        const targetCategories = replace ? categoriesMentioned(replace[1], catalog) : categoriesMentioned(text, catalog);
        if (!targetCategories.length) return false;
        request.protectedProductIds = request.proposedBasket.filter(line => keepCategories.includes(findProduct(catalog, line.productId)?.category)).map(line => line.productId);
        request.replaceProductIds = request.proposedBasket.filter(line => targetCategories.includes(findProduct(catalog, line.productId)?.category) && !request.protectedProductIds.includes(line.productId)).map(line => line.productId);
        request.replacementCategories = targetCategories;
        targetCategories.forEach(category => addUnique(request.categories, category));
        request.mode = "basket";
        request.lastOperation = "partial-replacement";
        return true;
    }

    function findProduct(catalog, id) { return (catalog || []).find(product => String(product?.id) === String(id)) || null; }

    function pricePaise(product) {
        const value = Number(product?.price);
        return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
    }

    function formatMoney(paise) {
        const rupees = Math.max(0, Number(paise) || 0) / 100;
        return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: rupees % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    }

    function resolveBudget(request) {
        const { amountPaise, scope } = request.budget;
        if (amountPaise === null) return null;
        if (scope === "per-person") return request.people ? amountPaise * request.people : null;
        return amountPaise;
    }

    function productScore(product, request, query) {
        const text = productText(product);
        const terms = normalizeText(query).split(/\s+/).filter(term => term.length > 2 && !STOP_WORDS.has(term));
        let score = terms.reduce((total, term) => total + (text.includes(term) ? 3 : 0), 0);
        if (product.featured === true) score += 1;
        if (request.preferences.priceStyle === "premium") {
            if (/premium|luxury|imported/i.test(`${product.badge || ""} ${product.subcategory || ""}`)) score += 6;
            score += Number(product.rating || 0) / 5;
        }
        if (request.preferences.priceStyle === "cheaper") score -= Math.log1p(Number(product.price) || 0) * 1.2;
        if (request.preferences.importedOnly && String(product.badge || "").toLowerCase() === "imported") score += 5;
        if (request.preferences.audience === "kids" && /kids?|children|kinder/i.test(text)) score += 8;
        if (request.preferences.focusCategories.includes(product.category)) score += 12;
        return score;
    }

    function importVerified(product) {
        return String(product?.category || "").toLowerCase() === "imported" || String(product?.badge || "").toLowerCase() === "imported";
    }

    function passesRestrictions(product, request) {
        const text = productText(product);
        if (request.preferences.importedOnly && !importVerified(product)) return false;
        if (request.preferences.audience === "kids" && !/\bkids?\b|\bchildren\b|\bkinder\b/.test(text)) return false;
        if (request.dietary.restrictions.includes("spicy") && SPICY_TERMS.some(term => includesPhrase(text, term))) return false;
        if (request.dietary.restrictions.includes("nuts") && NUT_TERMS.some(term => includesPhrase(text, term))) return false;
        if (request.dietary.restrictions.includes("sugar") && /sugar|sweetener/i.test(text)) return false;
        for (const category of request.excludedCategories) if (product.category === category) return false;
        if (request.excludedProductIds.map(String).includes(String(product.id))) return false;
        if (request.dietary.required.includes("vegetarian") || request.dietary.required.includes("vegan")) {
            const attribute = request.dietary.required.find(term => term === "vegetarian" || term === "vegan");
            if (!new RegExp(`\\b${attribute}\\b`, "i").test(text)) return false;
        }
        return true;
    }

    function requestedCategories(request, catalog) {
        if (request.categories.length) return request.categories;
        if (request.occasion === "party" || request.occasion === "birthday" || request.occasion === "house party" || request.occasion === "movie night" || request.occasion === "family gathering" || request.occasion === "picnic") {
            return [...new Set([...groupCategories("snacks", catalog), ...groupCategories("sweets", catalog)])];
        }
        if (request.occasion === "gifting") return [...new Set([...groupCategories("sweets", catalog), ...groupCategories("grocery", catalog)])];
        if (request.occasion === "travel") return [...new Set([...groupCategories("snacks", catalog), ...groupCategories("drinks", catalog)])];
        return [];
    }

    function retrieveProducts(catalog, request, query, { omitPrevious = false } = {}) {
        const categories = requestedCategories(request, catalog);
        const categoryFilter = new Set(categories);
        const budget = resolveBudget(request);
        const removedIds = new Set([...(request.replaceProductIds || []).map(String)]);
        const previousIds = omitPrevious ? new Set(request.recommendedIds.map(String)) : new Set();
        const rows = (catalog || []).filter(product => {
            if (!product || product.available === false) return false;
            if (pricePaise(product) === null) return false;
            if (categoryFilter.size && !categoryFilter.has(product.category)) return false;
            if (!passesRestrictions(product, request)) return false;
            if (removedIds.has(String(product.id)) || previousIds.has(String(product.id))) return false;
            if (budget !== null && request.budget.scope !== "per-person" && pricePaise(product) > budget) return false;
            return true;
        });
        const requireQueryMatch = !categoryFilter.size && !request.occasion && request.budget.amountPaise === null && Boolean(String(query || "").trim());
        return rows.map(product => ({ product, score: productScore(product, request, query) }))
            .filter(entry => !requireQueryMatch || normalizeText(query).split(/\s+/).some(term => term.length > 2 && !STOP_WORDS.has(term) && productText(entry.product).includes(term)))
            .sort((a, b) => b.score - a.score || (request.preferences.priceStyle === "premium" ? pricePaise(b.product) - pricePaise(a.product) : pricePaise(a.product) - pricePaise(b.product)) || String(a.product.name).localeCompare(String(b.product.name)))
            .map(entry => entry.product);
    }

    function explainProduct(product, request) {
        const notes = [];
        if (request.preferences.importedOnly && importVerified(product)) notes.push("marked imported in the catalogue");
        if (request.budget.amountPaise !== null) notes.push(`priced at ${formatMoney(pricePaise(product))}`);
        if (request.preferences.audience === "kids" && /kids?|children|kinder/i.test(productText(product))) notes.push("labelled for kids in the catalogue");
        if (request.preferences.priceStyle === "premium" && /premium|luxury/i.test(`${product.badge || ""} ${product.subcategory || ""}`)) notes.push("catalogue marks it as premium");
        if (notes.length) return notes.join(" · ");
        return product.category ? `A ${product.category} option from the current catalogue.` : "Matched from the current catalogue.";
    }

    function activeBudgetPaise(request) {
        if (request.budget.scope === "per-item") return null;
        return resolveBudget(request);
    }

    function buildBasket(products, request, catalog) {
        const budget = activeBudgetPaise(request);
        const existing = [];
        let totalPaise = 0;
        const protectedIds = new Set(request.protectedProductIds.map(String));
        for (const id of request.protectedProductIds) {
            const product = findProduct(catalog, id);
            if (!product || product.available === false || !passesRestrictions(product, request)) continue;
            const quantity = Math.max(1, Math.min(99, Number(request.quantities[id] || 1)));
            const subtotal = pricePaise(product) * quantity;
            if (budget !== null && totalPaise + subtotal > budget) continue;
            existing.push({ product, quantity });
            totalPaise += subtotal;
        }
        const lines = [...existing];
        const lineTarget = Math.max(lines.length, Math.min(MAX_LINES, Number(request.itemTarget) || 5));
        const usedProducts = new Set(lines.map(line => String(line.product.id)));
        const categories = requestedCategories(request, catalog);
        const sortedCategories = [...categories].sort((a, b) => {
            const focus = request.preferences.focusCategories;
            const replacement = request.replacementCategories;
            return Number(replacement.includes(b)) - Number(replacement.includes(a)) || Number(focus.includes(b)) - Number(focus.includes(a));
        });

        function addCandidate(product) {
            if (lines.length >= lineTarget || usedProducts.has(String(product.id))) return false;
            const quantity = Math.max(1, Math.min(99, Number(request.quantities[product.id] || request.requestedQuantity || 1)));
            const subtotal = pricePaise(product) * quantity;
            if (budget !== null && totalPaise + subtotal > budget) return false;
            lines.push({ product, quantity });
            usedProducts.add(String(product.id));
            totalPaise += subtotal;
            return true;
        }

        // One pick per requested category makes a mixed basket visibly diverse.
        for (const category of sortedCategories) {
            if (lines.length >= lineTarget) break;
            const candidate = products.find(product => product.category === category && !usedProducts.has(String(product.id)));
            if (candidate) addCandidate(candidate);
        }
        const varied = [...products].sort((a, b) => {
            const usedA = lines.some(line => line.product.category === a.category) ? 1 : 0;
            const usedB = lines.some(line => line.product.category === b.category) ? 1 : 0;
            return usedA - usedB || productScore(b, request, "") - productScore(a, request, "") || pricePaise(a) - pricePaise(b);
        });
        for (const product of varied) {
            if (lines.length >= lineTarget) break;
            addCandidate(product);
        }

        request.proposedBasket = lines.map(({ product, quantity }) => ({ productId: product.id, quantity }));
        request.recommendedIds = lines.map(line => line.product.id);
        request.lastOperation = "recommendations-recalculated";
        request.recalculationCount += 1;
        return { lines, totalPaise, remainingPaise: budget === null ? null : Math.max(0, budget - totalPaise), budgetPaise: budget };
    }

    function unclearDietMessage(request) {
        if (request.dietary.required.includes("vegetarian") || request.dietary.required.includes("vegan")) {
            return "The current catalogue doesn’t include reliable vegetarian or vegan labels, so I can’t filter those safely. I’ve kept that requirement visible; would you like to browse options with the details shown on their product pages?";
        }
        if (request.preferences.audience === "kids") return "I couldn’t find products explicitly labelled for kids that match the rest of your request. Want to browse chocolates or biscuits instead?";
        return "I couldn’t find a suitable in-stock selection within those limits. You can raise the budget, remove a restriction, or choose another category.";
    }

    function clarify(text, state, intent) {
        const request = state.request;
        if (intent.type === "yes" || intent.type === "no") {
            const question = request.lastQuestion;
            if (intent.type === "no") return "No problem. I’ll keep the current selection as it is.";
            if (question?.expectedType === "mix") { request.preferences.mix = true; request.mode = "basket"; return null; }
            if (question?.expectedType === "add-drinks") { groupCategories("drinks", []); return "Sure — should I add soft drinks, energy drinks, or either?"; }
            return "Sure — what would you like me to adjust?";
        }
        if (/^mix$/.test(text)) return null;
        if (/^more$/.test(text)) return null;
        if (/^cheaper$/.test(text)) return null;
        if (/^premium$/.test(text)) return null;
        if (/^yes$|^no$/.test(text)) return "What should I apply that to?";
        if (/^same but under\b/.test(text) && !request.intent) return "What would you like me to find within that budget?";
        return null;
    }

    function answerText(request, products, basket, query, notice) {
        const activeCategories = requestedCategories(request, products);
        const hasSnackGroup = activeCategories.some(category => /snack|namkeen|biscuit/i.test(category));
        const hasDrinkGroup = activeCategories.some(category => /beverage|energy drink/i.test(category));
        const label = request.occasion
            ? `${request.occasion} ${hasSnackGroup && !hasDrinkGroup ? "snack mix" : "mix"}`
            : activeCategories.length > 3 && hasSnackGroup && !hasDrinkGroup ? "snack mix"
                : activeCategories.length > 3 ? "mixed basket"
                    : activeCategories.join(" and ") || "store picks";
        if (!products.length || (basket && !basket.lines.length)) return { text: `${notice ? `${notice} ` : ""}${unclearDietMessage(request)}`, productCards: [], basket: null };
        const text = normalizeText(query);
        let opening = "Here are some options from the current catalogue.";
        if (request.mode === "basket" && basket) {
            opening = `Here’s a ${request.preferences.mix || activeCategories.length > 1 ? "varied " : "curated "}${label} selection${request.budget.amountPaise !== null ? ` within ${formatMoney(request.budget.amountPaise)}${request.budget.scope === "per-person" ? " per person" : ""}` : ""}.`;
            if (request.people) opening += ` Planned for ${request.people} people; pack serving sizes aren’t listed in the catalogue, so quantities are editable estimates.`;
            opening += `\nBasket total: ${formatMoney(basket.totalPaise)}.`;
            if (basket.remainingPaise !== null) opening += ` Remaining budget: ${formatMoney(basket.remainingPaise)}.`;
            if (request.dietary.restrictions.length) opening += `\nI filtered out products whose catalogue details mention ${request.dietary.restrictions.join(" and ")}; the catalogue doesn’t provide verified allergy labels.`;
            if (notice) opening = `${notice} ${opening}`;
            return { text: opening, productCards: basket.lines.map(({ product, quantity }) => ({ product, quantity, reason: explainProduct(product, request) })), basket };
        }
        const shown = products.slice(request.resultOffset, request.resultOffset + 5);
        if (text.includes("price") || text.includes("how much")) opening = "I found these current catalogue prices.";
        if (notice) opening = `${notice} ${opening}`;
        return { text: opening, productCards: shown.map(product => ({ product, quantity: request.requestedQuantity, reason: explainProduct(product, request) })), basket: null };
    }

    function operationPrompt(request, intent, text, catalog) {
        if (/\b(add|take)\s+(?:the\s+)?(?:last|first|second|third|fourth|fifth|that)\b.*\bcart\b/.test(text)) return { type: "cart-clarification", message: "Which product would you like to add? Use its Add to cart button so I can use the store’s verified price." };
        if (intent.type === "cart-query") return { type: "cart-query" };
        if (/\b(add|put)\b.*\bcart\b/.test(text)) return { type: "cart-clarification", message: "Choose Add to cart on the product you want. That confirms the change and uses the store’s current price." };
        if (intent.type === "comparison") return { type: "comparison" };
        if (intent.type === "attribute-question") return { type: "attribute-question" };
        const exact = (catalog || []).filter(product => product.available !== false && productText(product).includes(normalizeText(text)) && pricePaise(product) !== null);
        if (exact.length) return { type: "product-match", products: exact };
        return null;
    }

    function processMessage(inputState, rawMessage, catalog) {
        const state = sanitizeState(inputState);
        const raw = String(rawMessage ?? "").trim();
        if (!raw) return { state, response: { text: "Type a product or shopping question to get started.", productCards: [], suggestions: [] }, accepted: false };
        if (raw.length > MAX_MESSAGE_LENGTH) return { state, response: { text: `Please keep your message under ${MAX_MESSAGE_LENGTH} characters so I can handle it reliably.`, productCards: [], suggestions: [] }, accepted: false };
        const text = normalizeText(raw);
        state.history.push({ role: "user", text: raw });
        state.history = state.history.slice(-MAX_HISTORY);
        const request = state.request;
        const intent = classifyIntent(text, request, catalog);
        let message = null;
        let notice = "";
        let operation = null;

        if (intent.type === "reset") {
            startTask(request, true);
            message = "Fresh start. What would you like to shop for? Your store cart is unchanged.";
            request.lastOperation = "new-task";
        } else if (intent.type === "greeting") {
            message = "Hi! I'm Vee, your personal shopping assistant at Vinayak Superstore. What are you looking for today?";
        } else if (intent.type === "help") {
            message = "I can find products, plan a basket from the live catalogue, compare available items, and update a plan when your budget or preferences change.";
        } else {
            const previousBudget = request.budget.amountPaise;
            if (intent.type === "new-task") {
                startTask(request, true);
                request.categories = [...intent.categories];
                request.intent = "product-discovery";
                request.mode = "recommendation";
                request.lastOperation = "new-task";
                notice = "Starting a separate shopping request.";
            }
            if (intent.type === "partial-replace") handlePartialReplacement(request, text, catalog);
            const previousRequest = JSON.parse(JSON.stringify(request));
            const update = updateRequest(request, intent, text, catalog);
            if (update.budgetError) {
                Object.keys(request).forEach(key => delete request[key]);
                Object.assign(request, previousRequest);
                message = update.budgetError === "negative" ? "A budget can’t be negative. Tell me a positive amount and I’ll recalculate." : "That budget is outside the range I can calculate. Please use an amount up to ₹10,00,000.";
            } else if (update.budgetNeedsBase) {
                message = "I don’t have an active budget to adjust yet. What total budget should I start from?";
                request.lastQuestion = { text: "What total budget should I start from?", expectedType: "budget" };
            } else if (request.budget.scope === "per-person" && request.people === null && intent.type !== "alternatives") {
                message = "How many people should I use to calculate the total budget?";
                request.lastQuestion = { text: "How many people should I use to calculate the total budget?", expectedType: "people" };
            } else if (intent.type === "budget-change" && !parseAmount(text, request.lastQuestion?.expectedType === "budget")) {
                message = request.budget.amountPaise === null ? "What budget amount should I use?" : "By how much should I change the budget?";
                request.lastQuestion = { text: message, expectedType: "budget" };
            } else if (intent.type === "yes" || intent.type === "no") {
                message = clarify(text, state, intent);
                if (!message) intent.type = "mix";
            } else if (intent.type === "alternatives") {
                const pool = retrieveProducts(catalog, request, text, { omitPrevious: true });
                if (!pool.length) message = "I’ve run through the matching in-stock options. Want me to broaden the category or remove a constraint?";
                else {
                    request.resultIds = pool.map(product => product.id);
                    request.resultOffset = 0;
                    message = "Here’s another set of matching options, excluding products I’ve already shown.";
                    operation = "alternatives";
                }
            } else if (intent.type === "category-browse") {
                message = `I can browse ${categoryNames(catalog).join(", ")}. Which would you like to explore?`;
            } else {
                operation = operationPrompt(request, intent, text, catalog);
                if (operation?.type === "cart-query") {
                    message = "Your store cart is separate from this proposed basket. Open the cart button on the site to see its current contents.";
                } else if (operation?.type === "cart-clarification") {
                    message = operation.message;
                } else if (operation?.type === "comparison") {
                    const products = request.proposedBasket.map(line => findProduct(catalog, line.productId)).filter(Boolean).slice(0, 2);
                    if (products.length < 2) message = "Tell me the two product names you’d like to compare, or start with a product category.";
                    else {
                        const [first, second] = products;
                        message = `${first.name}: ${formatMoney(pricePaise(first))}${first.subcategory ? ` · ${first.subcategory}` : ""}. ${second.name}: ${formatMoney(pricePaise(second))}${second.subcategory ? ` · ${second.subcategory}` : ""}. These are the attributes the catalogue provides.`;
                    }
                } else if (operation?.type === "attribute-question") {
                    const queryTerms = text.split(/\s+/).filter(term => term.length > 2 && !STOP_WORDS.has(term));
                    const product = (catalog || []).filter(item => item.available !== false).map(item => ({ item, score: queryTerms.reduce((sum, term) => sum + (productText(item).includes(term) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score)[0];
                    message = product?.score ? `${product.item.name} is ${formatMoney(pricePaise(product.item))}${product.item.subcategory ? ` and is listed as ${product.item.subcategory}` : ""}. ${product.item.description || "The catalogue has no further description for it."}` : "I couldn’t identify that product in the current catalogue. Share its name or choose a category and I’ll look again.";
                }
                if (!message && intent.type === "unclear") {
                    const matches = retrieveProducts(catalog, request, text);
                    if (matches.length) {
                        request.intent = "product-discovery";
                        request.mode = "recommendation";
                        request.resultIds = matches.map(product => product.id);
                        request.resultOffset = 0;
                        notice = `I couldn’t find that exact item, but these catalogue options match part of “${raw}”.`;
                    } else message = `I couldn’t match “${raw}” to an available product in the catalogue. Try a category such as snacks, chocolates, drinks, or coffee.`;
                }
                if (!message && !request.intent && !request.mode) {
                    const pool = retrieveProducts(catalog, request, text);
                    if (!pool.length) message = `I couldn’t match “${raw}” to an available product in the catalogue. Try a category such as snacks, chocolates, drinks, or coffee.`;
                    else {
                        request.intent = "product-discovery";
                        request.mode = "recommendation";
                        request.resultIds = pool.map(product => product.id);
                        request.resultOffset = 0;
                    }
                }
                if (!message && intent.type !== "alternatives" && intent.type !== "category-browse") {
                    if (update.budgetError) message = update.budgetError === "negative" ? "A budget can’t be negative. Tell me a positive amount and I’ll recalculate." : "That budget is outside the range I can calculate. Please use an amount up to ₹10,00,000.";
                    else {
                        if (intent.type === "cheaper") notice = "I’ve sorted for lower-priced alternatives.";
                        if (intent.type === "premium") notice = "I’ve prioritised products marked premium in the catalogue.";
                        if (request.budget.amountPaise !== null && parseAmount(text) && request.budget.amountPaise !== previousBudget) {
                            const change = previousBudget === null ? "Budget set" : request.budget.amountPaise > previousBudget ? "Budget increased" : "Budget reduced";
                            notice = `${change} to ${formatMoney(request.budget.amountPaise)}; I’ve recalculated the selection.`;
                        }
                        if (/\bfor \d+\s*(people|guests|friends)/.test(text) && request.people) notice = `Updated for ${request.people} people. `;
                        if (request.lastOperation === "partial-replacement") notice = "I kept the selected snack items and replaced the requested category. ";
                    }
                }
            }
        }

        let productCards = [];
        let basket = null;
        if (!message) {
            const pool = intent.type === "alternatives" && request.resultIds.length
                ? request.resultIds.map(id => findProduct(catalog, id)).filter(Boolean)
                : retrieveProducts(catalog, request, text);
            const shouldBasket = (request.mode === "basket" && request.budget.scope !== "per-item") || (request.budget.amountPaise !== null && request.budget.scope !== "per-item") || requestedCategories(request, catalog).length > 1;
            if (shouldBasket) {
                basket = buildBasket(pool, request, catalog);
                const result = answerText(request, pool, basket, text, notice);
                message = result.text;
                productCards = result.productCards;
            } else {
                request.resultIds = pool.map(product => product.id);
                request.resultOffset = 0;
                request.recommendedIds = pool.slice(0, 5).map(product => product.id);
                request.lastOperation = "recommendations-recalculated";
                request.recalculationCount += 1;
                const result = answerText(request, pool, null, text, notice);
                message = result.text;
                productCards = result.productCards;
            }
            if (!productCards.length && request.dietary.required.length) message = unclearDietMessage(request);
        }

        if (intent.type === "alternatives" && !message.includes("run through")) {
            const pool = request.resultIds.map(id => findProduct(catalog, id)).filter(Boolean);
            const shown = pool.slice(request.resultOffset, request.resultOffset + 5);
            request.resultOffset += shown.length;
            request.recommendedIds = shown.map(product => product.id);
            productCards = shown.map(product => ({ product, quantity: request.requestedQuantity, reason: explainProduct(product, request) }));
        }

        if (!request.lastQuestion && (productCards.length || request.proposedBasket.length)) {
            request.lastQuestion = { text: "What would you like to adjust?", expectedType: "modification" };
        }
        state.history.push({ role: "assistant", text: String(message || "I couldn’t complete that request."), productIds: productCards.map(item => item.product.id), basket: basket ? request.proposedBasket : null });
        state.history = state.history.slice(-MAX_HISTORY);
        return {
            state,
            response: { text: message || "I couldn’t complete that request.", productCards, basket, suggestions: suggestedPrompts(request, catalog), operation: request.lastOperation },
            accepted: true
        };
    }

    function suggestedPrompts(request, catalog) {
        if (!request.intent && !request.categories.length && !request.occasion) return [["Plan party snacks", "Plan snacks for a party"], ["Imported chocolates", "Imported chocolates under ₹1500"], ["Browse coffee", "Find coffee"]];
        if (request.mode === "basket") {
            const chips = [];
            if (request.preferences.priceStyle !== "cheaper") chips.push(["Make it cheaper", "Make it cheaper"]);
            if (!request.preferences.focusCategories.some(category => /chocolate/i.test(category)) && groupCategories("sweets", catalog).length) chips.push(["Add more chocolates", "Add more chocolates"]);
            if (groupCategories("drinks", catalog).some(category => request.categories.includes(category)) && !request.excludedCategories.some(category => groupCategories("drinks", catalog).includes(category))) chips.push(["Remove drinks", "Remove drinks"]);
            if (request.budget.amountPaise !== null) chips.push(["Add ₹500 budget", "Increase budget by ₹500"]);
            if (request.recommendedIds.length) chips.push(["Show alternatives", "Show another option"]);
            return chips.slice(0, 4);
        }
        return [["Only imported", "Only imported"], ["Cheaper options", "Make it cheaper"], ["Show more", "Show more options"]];
    }

    function updateQuantity(stateInput, productId, quantity, catalog) {
        const original = sanitizeState(stateInput);
        const state = sanitizeState(stateInput);
        const product = findProduct(catalog, productId);
        const safeQuantity = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
        if (!product || !state.request.proposedBasket.some(line => String(line.productId) === String(productId))) return { state, changed: false };
        state.request.quantities[productId] = safeQuantity;
        state.request.proposedBasket = state.request.proposedBasket.map(line => String(line.productId) === String(productId) ? { ...line, quantity: safeQuantity } : line);
        state.request.lastOperation = "proposal-quantity-updated";
        const totals = basketTotals(state.request.proposedBasket, catalog, activeBudgetPaise(state.request));
        if (totals.remainingPaise !== null && totals.totalPaise > activeBudgetPaise(state.request)) return { state: original, changed: false, reason: "budget", totals };
        return { state, changed: true, totals };
    }

    function basketTotals(lines, catalog, budgetPaise) {
        const normalized = (lines || []).map(line => {
            const product = findProduct(catalog, line.productId);
            const quantity = Math.max(0, Number(line.quantity) || 0);
            const unitPaise = pricePaise(product);
            return { product, quantity, unitPaise, subtotalPaise: unitPaise === null ? null : unitPaise * quantity };
        });
        const totalPaise = normalized.reduce((sum, line) => sum + (line.subtotalPaise || 0), 0);
        return { lines: normalized, totalPaise, remainingPaise: budgetPaise === null ? null : Math.max(0, budgetPaise - totalPaise) };
    }

    function newConversation() { return createState(); }

    return {
        VERSION, MAX_MESSAGE_LENGTH, createState, sanitizeState, normalizeText, categoryNames, categoriesMentioned,
        classifyIntent, parseAmount, formatMoney, processMessage, updateQuantity, basketTotals, suggestedPrompts,
        retrieveProducts, buildBasket, pricePaise, requestedCategories, importVerified, newConversation
    };
});
