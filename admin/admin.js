(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const content = $('#content');
  let csrfToken = '';
  let username = '';
  let activeView = 'dashboard';
  let allProducts = [];
  let allCategories = [];
  let priceProducts = [];
  let priceOriginals = new Map();
  let priceDrafts = new Map();
  let selectedImageFile = null;
  let toastTimer;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}`;
  const date = value => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? '—' : parsed.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'});
  };
  const image = value => `/${esc(value || 'assets/images/placeholder.svg')}`;

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase()) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(url, {...options, headers, credentials:'same-origin', cache:'no-store'});
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401 && url !== '/api/auth/login') {
      csrfToken = '';
      $('#adminShell').hidden = true;
      $('#loginView').hidden = false;
    }
    if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
    return body;
  }

  function showAuthenticated(user, token) {
    username = user || 'Admin';
    csrfToken = token || '';
    $('#usernameLabel').textContent = username;
    $('#loginView').hidden = true;
    $('#adminShell').hidden = false;
    showView('dashboard');
  }

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const error = $('#loginError');
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const result = await api('/api/auth/login', {method:'POST', body:JSON.stringify({username:$('#loginUsername').value.trim(), password:$('#loginPassword').value})});
      $('#loginPassword').value = '';
      showAuthenticated(result.username, result.csrfToken);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  async function logout() {
    try { await api('/api/auth/logout', {method:'POST', body:'{}'}); } catch {}
    csrfToken = '';
    $('#adminShell').hidden = true;
    $('#loginView').hidden = false;
    $('#loginPassword').value = '';
  }
  $('#logoutButton').addEventListener('click', logout);
  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#navLinks').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) showView(button.dataset.view);
  });

  async function showView(view) {
    if (activeView === 'prices' && priceDrafts.size && !window.confirm('You have unsaved price changes. Discard them and leave Price Management?')) return;
    if (activeView === 'prices' && priceDrafts.size) priceDrafts.clear();
    activeView = view;
    $('#sidebar').classList.remove('open');
    document.querySelectorAll('.nav-link[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    const titles = {dashboard:'Dashboard',products:'Products',prices:'Price management',categories:'Categories',settings:'Settings'};
    $('#viewTitle').textContent = titles[view] || 'Dashboard';
    try {
      if (view === 'dashboard') await renderDashboard();
      else if (view === 'products') await renderProducts();
      else if (view === 'prices') await renderPrices();
      else if (view === 'categories') await renderCategories();
      else renderSettings();
    } catch (error) { toast(error.message); }
  }

  async function getProducts() {
    allProducts = await api('/api/admin/products');
    return allProducts;
  }
  async function getCategories() {
    allCategories = await api('/api/categories');
    return allCategories;
  }

  function viewHeading(title, subtitle, action = '') {
    return `<div class="view-heading"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${action}</div>`;
  }
  function recentRows(products) {
    if (!products.length) return '<p class="empty-placeholder">No products yet.</p>';
    return products.map(product => `<div class="recent-row"><img class="mini-image" src="${image(product.image)}" alt="" onerror="this.src='/assets/images/placeholder.svg'"><div class="recent-info"><strong>${esc(product.name)}</strong><span>${esc(product.category)} · ${money(product.price)}</span></div><span class="pill ${product.available ? '' : 'off'}">${product.available ? 'Available' : 'Unavailable'}</span></div>`).join('');
  }

  async function renderDashboard() {
    const data = await api('/api/admin/overview');
    content.innerHTML = `${viewHeading('Store overview','A quick view of your product catalogue.', '<button type="button" class="button primary" data-add-product>＋ Add product</button>')}
      <div class="stats-grid">
        <article class="stat-card"><span>Total products</span><strong>${data.total}</strong><small>Across your catalogue</small></article>
        <article class="stat-card"><span>Available</span><strong>${data.available}</strong><small>Visible and orderable</small></article>
        <article class="stat-card"><span>Unavailable</span><strong>${data.unavailable}</strong><small>Visible, ordering disabled</small></article>
        <article class="stat-card"><span>Categories</span><strong>${data.categories}</strong><small>Product groups</small></article>
      </div>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-head"><h3>Recently added</h3><button class="text-button" data-go="products">View products →</button></div><div class="panel-body">${recentRows(data.recentlyAdded)}</div></section>
        <section class="panel"><div class="panel-head"><h3>Recently updated</h3><button class="text-button" data-go="prices">Manage prices →</button></div><div class="panel-body">${recentRows(data.recentlyUpdated)}</div></section>
      </div>`;
    content.querySelector('[data-add-product]').addEventListener('click', () => openProductDialog());
    content.querySelector('[data-go="products"]').addEventListener('click', () => showView('products'));
    content.querySelector('[data-go="prices"]').addEventListener('click', () => showView('prices'));
  }

  function productRow(product) {
    return `<tr>
      <td><div class="product-cell"><img src="${image(product.image)}" alt="" loading="lazy" onerror="this.src='/assets/images/placeholder.svg'"><div><strong>${esc(product.name)}</strong><small>${esc(product.brand || '')}</small>${product.offer ? `<small>${esc(product.offer)}</small>` : ''}</div></div></td>
      <td>${esc(product.category)}</td><td><strong>${money(product.price)}</strong></td>
      <td><span class="pill ${product.available ? '' : 'off'}">${product.available ? 'Available' : 'Unavailable'}</span></td>
      <td>${date(product.updatedAt)}</td>
      <td><div class="actions">
        <button class="text-button" data-action="edit" data-id="${product.id}">Edit</button>
        <button class="text-button" data-action="duplicate" data-id="${product.id}">Duplicate</button>
        <button class="text-button" data-action="toggle" data-id="${product.id}">${product.available ? 'Disable' : 'Enable'}</button>
        <button class="text-button" data-action="history" data-id="${product.id}">Price history</button>
        <button class="text-button danger" data-action="delete" data-id="${product.id}">Delete</button>
      </div></td>
    </tr>`;
  }

  async function renderProducts() {
    await Promise.all([getProducts(), getCategories()]);
    content.innerHTML = `${viewHeading('Products','Search, filter, and update your store catalogue.', '<button type="button" class="button primary" data-add-product>＋ Add product</button>')}
      <div class="toolbar"><input id="productSearch" type="search" placeholder="Search products or categories…" aria-label="Search products"><select id="productCategoryFilter" aria-label="Filter by category"><option value="">All categories</option>${allCategories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><select id="availabilityFilter" aria-label="Filter availability"><option value="">All availability</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select><select id="productSort" aria-label="Sort products"><option value="name">Name A–Z</option><option value="price-low">Lowest price</option><option value="price-high">Highest price</option><option value="recent">Recently added</option><option value="updated">Recently updated</option></select></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Availability</th><th>Last updated</th><th>Actions</th></tr></thead><tbody id="productRows"></tbody></table></div>`;
    const updateRows = () => {
      const term = $('#productSearch').value.trim().toLowerCase();
      const category = $('#productCategoryFilter').value;
      const status = $('#availabilityFilter').value;
      const sort = $('#productSort').value;
      const rows = allProducts.filter(p => (!category || p.category === category) && (!status || (status === 'available') === p.available) && (!term || `${p.name} ${p.category} ${p.brand || ''} ${p.offer || ''}`.toLowerCase().includes(term)));
      const sorters = {name:(a,b)=>a.name.localeCompare(b.name), 'price-low':(a,b)=>a.price-b.price, 'price-high':(a,b)=>b.price-a.price, recent:(a,b)=>new Date(b.createdAt)-new Date(a.createdAt), updated:(a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)};
      rows.sort(sorters[sort] || sorters.name);
      $('#productRows').innerHTML = rows.length ? rows.map(productRow).join('') : '<tr><td colspan="6"><div class="empty-state">No products match these filters.</div></td></tr>';
    };
    ['productSearch','productCategoryFilter','availabilityFilter','productSort'].forEach(id => $(`#${id}`).addEventListener(id === 'productSearch' ? 'input' : 'change', updateRows));
    content.querySelector('[data-add-product]').addEventListener('click', () => openProductDialog());
    $('#productRows').addEventListener('click', handleProductAction);
    updateRows();
  }

  async function handleProductAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const product = allProducts.find(item => item.id === id);
    if (!product) return;
    try {
      if (button.dataset.action === 'edit') return openProductDialog(product);
      if (button.dataset.action === 'toggle') {
        await api(`/api/admin/products/${id}/availability`, {method:'PUT', body:JSON.stringify({available:!product.available})});
        toast(product.available ? 'Product marked unavailable.' : 'Product marked available.');
      } else if (button.dataset.action === 'duplicate') {
        const copy = await api(`/api/admin/products/${id}/duplicate`, {method:'POST', body:'{}'});
        toast('Draft duplicate created. Edit its name, image, and price before enabling it.');
        await renderProducts();
        return openProductDialog(copy);
      } else if (button.dataset.action === 'delete') {
        if (!window.confirm(`Delete ${product.name}? It will disappear from the storefront.`)) return;
        await api(`/api/admin/products/${id}`, {method:'DELETE'});
        toast('Product deleted.');
      } else if (button.dataset.action === 'history') return showPriceHistory(product);
      await renderProducts();
    } catch (error) { toast(error.message); }
  }

  const productDialog = $('#productDialog');
  function fillCategorySelect(selected = '') {
    $('#productCategory').innerHTML = allCategories.map(category=>`<option value="${esc(category)}" ${category===selected?'selected':''}>${esc(category)}</option>`).join('');
  }
  async function openProductDialog(product = null) {
    try {
      if (!allCategories.length) await getCategories();
      fillCategorySelect(product?.category || allCategories[0] || '');
      $('#productDialogTitle').textContent = product ? (product.createdAt === product.updatedAt ? 'Finish duplicate' : 'Edit product') : 'Add product';
      $('#productId').value = product?.id || '';
      $('#productName').value = product?.name || '';
      $('#productBrand').value = product?.brand || '';
      $('#productSubcategory').value = product?.subcategory || '';
      $('#productPrice').value = product?.price ?? '';
      $('#productOffer').value = product?.offer || '';
      $('#productDescription').value = product?.description || '';
      $('#productImagePath').value = product?.image || '';
      $('#imagePreview').src = product?.image ? image(product.image) : '/assets/images/placeholder.svg';
      $('#productAvailable').checked = product ? Boolean(product.available) : true;
      $('#productImageFile').value = '';
      $('#productFormError').hidden = true;
      selectedImageFile = null;
      productDialog.showModal();
    } catch (error) { toast(error.message); }
  }
  $('#productImageFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.target.value = '';
      $('#productFormError').textContent = 'Choose a PNG, JPEG, or WebP image up to 5 MB.';
      $('#productFormError').hidden = false;
      selectedImageFile = null;
      return;
    }
    selectedImageFile = file;
    $('#productImagePath').value = '';
    $('#imagePreview').src = URL.createObjectURL(file);
    $('#productFormError').hidden = true;
  });
  $('#productImagePath').addEventListener('input', event => {
    selectedImageFile = null;
    $('#productImageFile').value = '';
    const value = event.target.value.trim();
    if (value.startsWith('assets/')) $('#imagePreview').src = `/${value.replace(/^\/+/, '')}`;
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => productDialog.close()));
  $('#productForm').addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#productFormError');
    error.hidden = true;
    const button = $('#productSaveButton');
    button.disabled = true; button.textContent = 'Saving…';
    try {
      let imagePath = $('#productImagePath').value.trim();
      if (selectedImageFile) {
        const bytes = await selectedImageFile.arrayBuffer();
        let binary = '';
        new Uint8Array(bytes).forEach(byte => binary += String.fromCharCode(byte));
        const uploaded = await api('/api/admin/images', {method:'POST', body:JSON.stringify({data:btoa(binary)})});
        imagePath = uploaded.image;
      }
      const product = {name:$('#productName').value, brand:$('#productBrand').value, category:$('#productCategory').value, subcategory:$('#productSubcategory').value, price:$('#productPrice').value, offer:$('#productOffer').value, description:$('#productDescription').value, image:imagePath, available:$('#productAvailable').checked};
      const id = $('#productId').value;
      await api(id ? `/api/admin/products/${id}` : '/api/admin/products', {method:id?'PUT':'POST', body:JSON.stringify(product)});
      productDialog.close();
      toast(id ? 'Product updated.' : 'Product added.');
      await getProducts();
      await showView(activeView === 'prices' ? 'products' : activeView);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally { button.disabled = false; button.textContent = 'Save product'; }
  });

  function showPriceHistory(product) {
    $('#historyTitle').textContent = `Price history · ${product.name}`;
    const dialog = $('#historyDialog');
    $('#historyContent').innerHTML = '<p class="empty-placeholder">Loading price history…</p>';
    dialog.showModal();
    api(`/api/admin/price-history?productId=${product.id}`).then(rows => {
      $('#historyContent').innerHTML = rows.length ? rows.map(row=>`<div class="history-row"><strong>${money(row.old_price)} → ${money(row.new_price)}</strong><small>${date(row.changed_at)} · Updated by ${esc(row.changed_by)}</small></div>`).join('') : '<p class="empty-placeholder">No price changes recorded yet.</p>';
    }).catch(error => { $('#historyContent').textContent = error.message; });
  }
  document.querySelectorAll('[data-close-history]').forEach(button => button.addEventListener('click', () => $('#historyDialog').close()));

  async function renderPrices() {
    await Promise.all([getProducts(), getCategories()]);
    priceProducts = [...allProducts];
    priceOriginals = new Map(priceProducts.map(p => [p.id, String(p.price)]));
    priceDrafts = new Map();
    content.innerHTML = `${viewHeading('Price management','Enter replacement prices. Leave a field unchanged to keep its current price.')}
      <div class="toolbar"><input id="priceSearch" type="search" placeholder="Search product or category…" aria-label="Search prices"><select id="priceCategory" aria-label="Filter price list by category"><option value="">All categories</option>${allCategories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><select id="priceSort" aria-label="Sort price list"><option value="name">Name A–Z</option><option value="price-low">Lowest current price</option><option value="price-high">Highest current price</option></select></div>
      <div id="priceNotice"></div><div class="table-wrap"><table class="data-table price-table"><thead><tr><th>Product</th><th>Category</th><th>Current price</th><th>New price (₹)</th></tr></thead><tbody id="priceRows"></tbody></table></div>
      <div id="priceFooter" class="price-footer" hidden><span id="unsavedLabel">Unsaved changes</span><span class="spacer"></span><button type="button" id="saveCategoryButton" class="button secondary">Save category</button><button type="button" id="saveAllPricesButton" class="button primary">Save all changes</button></div>`;
    const renderRows = () => {
      const term = $('#priceSearch').value.trim().toLowerCase();
      const category = $('#priceCategory').value;
      const sort = $('#priceSort').value;
      const rows = priceProducts.filter(p => (!category || p.category === category) && (!term || `${p.name} ${p.category} ${p.brand || ''}`.toLowerCase().includes(term)));
      rows.sort(sort === 'price-low' ? (a,b)=>a.price-b.price : sort === 'price-high' ? (a,b)=>b.price-a.price : (a,b)=>a.name.localeCompare(b.name));
      $('#priceRows').innerHTML = rows.length ? rows.map(p=>`<tr><td><div class="product-cell"><img src="${image(p.image)}" alt="" loading="lazy" onerror="this.src='/assets/images/placeholder.svg'"><div><strong>${esc(p.name)}</strong></div></div></td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td><input class="price-input" type="number" min="0" step="0.01" inputmode="decimal" aria-label="New price for ${esc(p.name)}" data-price-id="${p.id}" value="${esc(priceDrafts.get(p.id) ?? '')}" placeholder="Keep current"></td></tr>`).join('') : '<tr><td colspan="4"><div class="empty-state">No products match your search.</div></td></tr>';
      updatePriceFooter();
    };
    const updatePriceFooter = () => {
      const count = priceDrafts.size;
      $('#priceFooter').hidden = count === 0;
      $('#unsavedLabel').textContent = count ? `${count} unsaved price ${count === 1 ? 'change' : 'changes'}` : '';
      $('#saveCategoryButton').disabled = !$('#priceCategory').value || !count;
    };
    const save = async categoryOnly => {
      const visibleIds = new Set([...$('#priceRows').querySelectorAll('[data-price-id]')].map(input=>Number(input.dataset.priceId)));
      const ids = [...priceDrafts.keys()].filter(id => !categoryOnly || visibleIds.has(id));
      if (!ids.length) return toast(categoryOnly ? 'Choose a category and enter prices first.' : 'There are no unsaved prices.');
      const invalid = [...$('#priceRows').querySelectorAll('.price-input.invalid')];
      if (invalid.length) return toast('Correct invalid prices before saving.');
      try {
        await api('/api/admin/prices', {method:'PUT', body:JSON.stringify({prices:ids.map(id=>({id,price:priceDrafts.get(id)}))})});
        toast(`${ids.length} price ${ids.length===1?'updated':'updates saved'}.`);
        await renderPrices();
      } catch (error) { toast(error.message); }
    };
    $('#priceSearch').addEventListener('input', renderRows);
    $('#priceCategory').addEventListener('change', renderRows);
    $('#priceSort').addEventListener('change', renderRows);
    $('#priceRows').addEventListener('input', event => {
      const input = event.target.closest('[data-price-id]');
      if (!input) return;
      const id = Number(input.dataset.priceId);
      const raw = input.value.trim();
      const valid = raw === '' || (Number.isFinite(Number(raw)) && Number(raw) >= 0);
      input.classList.toggle('invalid', !valid);
      input.classList.toggle('dirty', valid && raw !== '' && raw !== priceOriginals.get(id));
      if (!valid || raw === '' || raw === priceOriginals.get(id)) priceDrafts.delete(id);
      else priceDrafts.set(id, raw);
      updatePriceFooter();
    });
    $('#saveCategoryButton').addEventListener('click', () => save(true));
    $('#saveAllPricesButton').addEventListener('click', () => save(false));
    renderRows();
  }
  window.addEventListener('beforeunload', event => { if (priceDrafts.size) { event.preventDefault(); event.returnValue = ''; } });

  async function renderCategories() {
    await Promise.all([getCategories(), getProducts()]);
    const counts = new Map();
    allProducts.forEach(p=>counts.set(p.category,(counts.get(p.category)||0)+1));
    content.innerHTML = `${viewHeading('Categories','Keep product groups tidy. Categories with products cannot be deleted until those products are moved.')}
      <form id="categoryForm" class="category-create"><input id="newCategory" required maxlength="80" placeholder="New category name" aria-label="New category name"><button class="button primary" type="submit">＋ Add category</button></form>
      <section class="panel"><div id="categoryRows">${allCategories.map(category=>`<div class="category-row"><strong>${esc(category)}</strong><small>${counts.get(category)||0} products</small><button class="text-button" data-rename="${esc(category)}">Rename</button><button class="text-button danger" data-delete-category="${esc(category)}">Delete</button></div>`).join('')}</div></section>`;
    $('#categoryForm').addEventListener('submit', async event => {
      event.preventDefault();
      try { await api('/api/admin/categories',{method:'POST',body:JSON.stringify({name:$('#newCategory').value})}); toast('Category added.'); await renderCategories(); }
      catch(error){toast(error.message);}
    });
    $('#categoryRows').addEventListener('click', async event => {
      const rename = event.target.closest('[data-rename]');
      const remove = event.target.closest('[data-delete-category]');
      try {
        if (rename) {
          const oldName = rename.dataset.rename;
          const newName = window.prompt(`Rename ${oldName} to:`, oldName);
          if (!newName || newName.trim() === oldName) return;
          await api(`/api/admin/categories/${encodeURIComponent(oldName)}`,{method:'PUT',body:JSON.stringify({name:newName.trim()})});
          toast('Category renamed and product assignments updated.');
        } else if (remove) {
          const name = remove.dataset.deleteCategory;
          if (!window.confirm(`Delete category ${name}?`)) return;
          await api(`/api/admin/categories/${encodeURIComponent(name)}`,{method:'DELETE',body:'{}'});
          toast('Category deleted.');
        } else return;
        await renderCategories();
      } catch(error){toast(error.message);}
    });
  }

  function renderSettings() {
    content.innerHTML = `${viewHeading('Settings','Account and catalogue setup information.')}
      <section class="panel settings-card"><h3>Signed in as ${esc(username)}</h3><p>Your admin session is protected by a server-side login and expires after 12 hours. Product changes are stored in the local SQLite catalogue and price changes are recorded in the internal history log.</p><p>To manage the storefront, open <a href="/">the customer website</a>. To end this session on this device, log out.</p><button type="button" class="button secondary" id="settingsLogout">Log out</button></section>`;
    $('#settingsLogout').addEventListener('click', logout);
  }

  document.addEventListener('click', event => {
    const add = event.target.closest('[data-add-product]');
    if (add) openProductDialog();
  });

  async function boot() {
    try {
      const session = await api('/api/session');
      if (session.authenticated) showAuthenticated(session.username, session.csrfToken);
      else $('#loginUsername').focus();
    } catch { $('#loginUsername').focus(); }
  }
  boot();
})();
