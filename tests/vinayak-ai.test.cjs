const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ai = require("../scripts/vinayak-ai-engine.js");

const root = path.resolve(__dirname, "..");
const catalogPath = process.env.VINAYAK_TEST_CATALOG;
const catalog = catalogPath ? JSON.parse(fs.readFileSync(catalogPath, "utf8")) : [
    { id: 1, name: "Salted Crisps", brand: "Store", category: "Snacks", subcategory: "Crisps", price: 80, stock: 12, available: true, badge: "Popular", keywords: ["crisps", "salted"] },
    { id: 2, name: "Spicy Chilli Chips", brand: "Store", category: "Snacks", subcategory: "Chips", price: 90, stock: 12, available: true, badge: "Popular", keywords: ["spicy", "chilli"] },
    { id: 3, name: "Roasted Chickpeas", brand: "Store", category: "Namkeen", subcategory: "Roasted", price: 60, stock: 12, available: true, badge: "Classic", keywords: ["crunchy"] },
    { id: 4, name: "Chocolate Bar", brand: "Store", category: "Chocolates", subcategory: "Milk", price: 100, stock: 12, available: true, badge: "Imported", keywords: ["chocolate"] },
    { id: 5, name: "Dark Chocolate", brand: "Store", category: "Chocolates", subcategory: "Dark", price: 180, stock: 12, available: true, badge: "Imported", keywords: ["chocolate", "dark"] },
    { id: 6, name: "Cola", brand: "Store", category: "Beverages", subcategory: "Soft Drink", price: 75, stock: 12, available: true, badge: "Popular", keywords: ["drink"] },
    { id: 7, name: "Energy Drink", brand: "Store", category: "Energy Drinks", subcategory: "Can", price: 120, stock: 12, available: true, badge: "Imported", keywords: ["drink"] },
    { id: 8, name: "Coffee", brand: "Store", category: "Coffee", subcategory: "Ground", price: 240, stock: 12, available: true, badge: "Premium", keywords: ["coffee"] },
    { id: 9, name: "Hazelnut Chocolate", brand: "Store", category: "Chocolates", subcategory: "Nut", price: 160, stock: 12, available: true, badge: "Imported", keywords: ["hazelnut", "chocolate"] },
    { id: 10, name: "Unavailable Crisps", brand: "Store", category: "Snacks", subcategory: "Crisps", price: 30, stock: 0, available: false, badge: "Popular", keywords: ["crisps"] }
];

const byId = new Map(catalog.map(product => [String(product.id), product]));
function say(state, text) { return ai.processMessage(state, text, catalog); }
function productLines(state) { return state.request.proposedBasket.map(line => ({ ...line, product: byId.get(String(line.productId)) })); }
function total(state) { return ai.basketTotals(state.request.proposedBasket, catalog, null).totalPaise; }

test("party planning keeps one task through mix, more chocolates, and cheaper", () => {
    let state = ai.createState();
    state = say(state, "Plan snacks for a party").state;
    const taskId = state.request.taskId;
    assert.equal(state.request.occasion, "party");
    state = say(state, "Mix").state;
    assert.equal(state.request.preferences.mix, true);
    assert.equal(state.request.taskId, taskId);
    assert.ok(state.request.proposedBasket.length > 0);
    state = say(state, "More chocolates").state;
    assert.ok(state.request.categories.includes("Chocolates"));
    assert.equal(state.request.taskId, taskId);
    state = say(state, "Make it cheaper").state;
    assert.equal(state.request.preferences.priceStyle, "cheaper");
    assert.equal(state.request.occasion, "party");
    assert.equal(state.request.taskId, taskId);
});

test("budget increase recalculates and preserves imported chocolate constraints", () => {
    let result = say(ai.createState(), "Suggest imported chocolates under ₹1500");
    let state = result.state;
    assert.equal(state.request.budget.amountPaise, 150000);
    assert.equal(state.request.preferences.importedOnly, true);
    const countBefore = state.request.recalculationCount;
    result = say(state, "Increase budget by ₹1000");
    state = result.state;
    assert.equal(state.request.budget.amountPaise, 250000);
    assert.equal(state.request.preferences.importedOnly, true);
    assert.ok(state.request.recalculationCount > countBefore);
    assert.match(result.response.text, /Budget increased to ₹2,500/);
    assert.ok((result.response.productCards || []).every(card => ai.importVerified(card.product)));
    assert.ok(total(state) <= 250000);
});

test("budget decreases by the requested amount and basket stays below its new cap", () => {
    let state = say(ai.createState(), "Build a basket under ₹2000").state;
    assert.equal(state.request.budget.amountPaise, 200000);
    const countBefore = state.request.recalculationCount;
    const result = say(state, "Reduce budget by ₹500");
    state = result.state;
    assert.equal(state.request.budget.amountPaise, 150000);
    assert.ok(state.request.recalculationCount > countBefore);
    assert.ok(total(state) <= 150000);
});

test("adding chocolates preserves budget and no-spicy restriction", () => {
    let state = say(ai.createState(), "Party snacks under ₹1000, no spicy products").state;
    state = say(state, "Add chocolates").state;
    assert.equal(state.request.budget.amountPaise, 100000);
    assert.ok(state.request.dietary.restrictions.includes("spicy"));
    assert.ok(state.request.categories.includes("Chocolates"));
    assert.ok(total(state) <= 100000);
    assert.ok(productLines(state).every(line => !/spicy|chilli|chili|masala|peri peri/i.test(`${line.product.name} ${line.product.description || ""} ${(line.product.keywords || []).join(" ")}`)));
});

test("partial replacement keeps selected snack products and changes drink lines", () => {
    let state = say(ai.createState(), "Give me snacks and drinks").state;
    const keptBefore = productLines(state).filter(line => /snack|namkeen|biscuit/i.test(line.product.category));
    assert.ok(keptBefore.length > 0);
    const result = say(state, "Keep the snacks but replace the drinks");
    state = result.state;
    const after = new Map(productLines(state).map(line => [String(line.productId), line.quantity]));
    keptBefore.forEach(line => assert.equal(after.get(String(line.productId)), line.quantity));
    assert.match(result.response.text, /kept the selected snack items/i);
    assert.ok(state.request.replacementCategories.some(category => /beverage|energy drink/i.test(category)));
});

test("comma phrasing keeps one category while replacing another", () => {
    let state = say(ai.createState(), "Give me snacks and drinks").state;
    const keptBefore = productLines(state).filter(line => /snack|namkeen|biscuit/i.test(line.product.category));
    const result = say(state, "Keep the snacks, change the drinks");
    state = result.state;
    const after = new Map(productLines(state).map(line => [String(line.productId), line.quantity]));
    keptBefore.forEach(line => assert.equal(after.get(String(line.productId)), line.quantity));
    assert.ok(state.request.replacementCategories.some(category => /beverage|energy drink/i.test(category)));
});

test("an ambiguous yes is answered with one contextual clarification", () => {
    let state = say(ai.createState(), "Suggest chocolates").state;
    const result = say(state, "Yes.");
    assert.match(result.response.text, /what would you like me to adjust/i);
    assert.equal(result.state.request.categories.includes("Chocolates"), true);
});

test("an unrelated category starts a clean request without old budget or occasion", () => {
    let state = say(ai.createState(), "Plan party snacks under ₹1000").state;
    const oldTask = state.request.taskId;
    state = say(state, "Need coffee").state;
    assert.notEqual(state.request.taskId, oldTask);
    assert.deepEqual(state.request.categories, ["Coffee"]);
    assert.equal(state.request.occasion, null);
    assert.equal(state.request.budget.amountPaise, null);
});

test("unknown products are not invented and every displayed result belongs to the live catalogue", () => {
    const result = say(ai.createState(), "Do you stock a moon mango truffle?");
    assert.match(result.response.text, /couldn’t (?:find that exact item|match .+ to an available product in the catalogue)/i);
    const catalogIds = new Set(catalog.map(product => String(product.id)));
    assert.ok(result.response.productCards.every(card => catalogIds.has(String(card.product.id))));
    let state = say(ai.createState(), "Find chocolates").state;
    assert.ok(state.request.recommendedIds.every(id => catalogIds.has(String(id))));
});

test("basket quantities use paise and totals plus remaining budget stay exact", () => {
    let state = say(ai.createState(), "Build snacks and drinks under ₹1000").state;
    const line = state.request.proposedBasket[0];
    assert.ok(line);
    const updated = ai.updateQuantity(state, line.productId, 3, catalog);
    assert.equal(updated.changed, true);
    state = updated.state;
    const product = byId.get(String(line.productId));
    const expected = Math.round(Number(product.price) * 100) * 3 + state.request.proposedBasket.slice(1).reduce((sum, other) => sum + Math.round(Number(byId.get(String(other.productId)).price) * 100) * other.quantity, 0);
    const totals = ai.basketTotals(state.request.proposedBasket, catalog, 100000);
    assert.equal(totals.totalPaise, expected);
    assert.equal(totals.remainingPaise, Math.max(0, 100000 - expected));
});

test("quantity controls cannot push a proposed basket past its active budget", () => {
    const state = say(ai.createState(), "Build snacks and drinks under ₹1000").state;
    const line = state.request.proposedBasket[0];
    assert.ok(line);
    const product = byId.get(String(line.productId));
    const blocked = ai.updateQuantity(state, line.productId, 99, catalog);
    assert.equal(blocked.changed, false);
    assert.equal(blocked.reason, "budget");
    assert.equal(blocked.state.request.quantities[line.productId] || line.quantity, line.quantity);
    assert.ok(product);
    assert.ok(total(state) <= state.request.budget.amountPaise);
});

test("rapid sequential changes retain the latest budget and do not lose the task", () => {
    let state = say(ai.createState(), "Plan snacks for a party under ₹2000").state;
    const taskId = state.request.taskId;
    state = say(state, "Add ₹500 to my budget").state;
    state = say(state, "No, 500 less").state;
    state = say(state, "For 8 friends").state;
    assert.equal(state.request.taskId, taskId);
    assert.equal(state.request.budget.amountPaise, 200000);
    assert.equal(state.request.people, 8);
    assert.ok(total(state) <= 200000);
});

test("editing a proposal never changes the separate store cart context", () => {
    let state = say(ai.createState(), "Plan snacks and drinks under ₹1500").state;
    state.cartContext = [{ productId: catalog[0].id, quantity: 2 }];
    const before = JSON.stringify(state.cartContext);
    state = say(state, "Remove the drinks").state;
    assert.equal(JSON.stringify(state.cartContext), before);
    assert.ok(state.request.proposedBasket.every(line => !/beverage|energy drink/i.test(byId.get(String(line.productId)).category)));
});

test("the assistant controls and layout have mobile and keyboard support", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const css = fs.readFileSync(path.join(root, "styles/vinayak-ai.css"), "utf8");
    const ui = fs.readFileSync(path.join(root, "scripts/vinayak-ai.js"), "utf8");
    assert.match(html, /aria-controls="vinayakAi"/);
    assert.match(html, /enterkeyhint="send"/);
    assert.match(css, /@media\(max-width:600px\)/);
    assert.match(css, /100dvh/);
    assert.match(ui, /event\.key === "Escape"/);
    assert.match(ui, /queue = queue\.then/);
});

test("customer-facing assistant branding consistently uses Vee", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const ui = fs.readFileSync(path.join(root, "scripts/vinayak-ai.js"), "utf8");
    assert.match(html, /aria-label="Open Vee shopping assistant"/);
    assert.match(html, /title="Chat with Vee"/);
    assert.match(html, /<strong id="vinayakAiTitle">Vee<\/strong>/);
    assert.match(html, /Your personal shopping assistant/);
    assert.doesNotMatch(html, /Vinayak AI/i);
    assert.match(ui, /Hey! I'm Vee/);
    assert.match(ui, /aria-label", "Vee response"/);
    assert.match(ui, /aria-label", "Vee is thinking…"/);
    assert.match(ui, /row\.text\.replace\(\/\\bVinayak AI\\b\/gi, "Vee"\)/);
    assert.match(ui, /vinayakAiConversationV2/);
    assert.match(say(ai.createState(), "Hi").response.text, /I'm Vee, your personal shopping assistant/);
});
