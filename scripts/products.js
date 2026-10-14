/* Vinayak Superstore catalogue UI. Records load from the same-origin product service. */

let products=[];
const escapeProductHTML=value=>String(value??'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

/* ============================================================
                GENERATE PRODUCTS
============================================================ */

const grid=document.querySelector(".product-grid");
const productImageFallback="assets/images/placeholder.svg";
let currentProduct=null;

function getProductImage(product){

    return product.image || productImageFallback;

}

function getProductOffer(product){

    if(product.offer) return String(product.offer);
    if(product.badge === "BUY 1 GET 1") return "BUY 1 GET 1";
    if(product.badge === "BOGO" || product.badge === "BUY ONE GET ONE FREE") return "BUY ONE GET ONE FREE";
    return "";

}

function loadProducts(list=products){

    if(!grid) return;

    grid.innerHTML=list.map(product=>`

<article class="product-card">


    <div class="card-top">

<button

class="wishlist-icon"

onclick="event.stopPropagation(); toggleWishlist(${product.id})">

<i class="${
    typeof isWishlisted==="function" && isWishlisted(product.id)
        ? "fa-solid"
        : "fa-regular"
} fa-heart"></i>

</button>

    </div>

    <img src="${escapeProductHTML(getProductImage(product))}" alt="${escapeProductHTML(product.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${productImageFallback}'">

    ${getProductOffer(product) ? `<span class="offer-pill">${escapeProductHTML(getProductOffer(product))}</span>` : ''}

    <div class="rating">

        ⭐${product.rating}

        <span>(${product.reviews} Reviews)</span>

    </div>

    <h3>${escapeProductHTML(product.name)}</h3>

    <p>${escapeProductHTML(product.description)}</p>

    <div class="price-stock">

        <h4>₹${product.price}</h4>

        <span class="stock ${product.available===false ? "unavailable" : ""}">

            ${
                product.available===false
                ? "Currently unavailable"
                : (product.stock>10 ? "In Stock" : (product.stock>0 ? `Only ${product.stock} Left` : "In Stock"))
            }

        </span>

    </div>

    <button class="view-btn"

        onclick="openProduct(${product.id})">

        👁 Quick View

    </button>

</article>

`).join("");

    document.dispatchEvent(new CustomEvent("products:rendered"));

}


/* ============================================================
                PRODUCT POPUP
============================================================ */

function openProduct(id){

const product=products.find(p=>p.id===id);

if(!product) return;

document

.getElementById("popupWishlist")

.onclick = () =>

toggleWishlist(product.id);

document
.getElementById("popupOverlay")
.dataset.productId=id;

currentProduct = product;

document.getElementById("popupTitle").innerText=product.name;

const popupImageElement=document.getElementById("popupImage");
popupImageElement.src=getProductImage(product);
popupImageElement.onerror=()=>{ popupImageElement.onerror=null; popupImageElement.src=productImageFallback; };

document.getElementById("popupDescription").innerText=product.description;

const popupOffer=document.getElementById("popupOffer");
popupOffer.textContent=getProductOffer(product);
popupOffer.hidden=!popupOffer.textContent;

document.getElementById("popupPrice").innerText="₹"+product.price;

document.getElementById("popupStock").innerText=

product.available===false

? "Currently unavailable"

: `${product.stock} in stock`;

const unavailable=product.available===false;
document.querySelector(".buy-btn").disabled=unavailable;
document.getElementById("quantity").disabled=unavailable;
document.querySelectorAll(".quantity-box button").forEach(button=>button.disabled=unavailable);

document.getElementById("quantity").value=1;

document

.getElementById("popupOverlay")

.classList.add("show");

document.getElementById("popupOverlay").setAttribute("aria-hidden", "false");
document.querySelector(".popup-close")?.focus();

}

/* ============================================================
                CLOSE POPUP
============================================================ */

function closePopup(){

document

.getElementById("popupOverlay")

.classList.remove("show");

document.getElementById("popupOverlay").setAttribute("aria-hidden", "true");

}

function changeQuantity(change){

const input=document.getElementById("quantity");

let value=parseInt(input.value)||1;

value+=change;

if(value<1) value=1;

input.value=value;

}

/* ============================================================
                SEARCH
============================================================ */

function searchProducts(query){

query=query.toLowerCase().trim();

if(query===""){

loadProducts(

products.filter(

p=>p.featured

)

);

return;

}

const filtered=products.filter(product=>{

return(

product.name.toLowerCase().includes(query)||

product.brand.toLowerCase().includes(query)||

product.category.toLowerCase().includes(query)||

product.subcategory.toLowerCase().includes(query)||

product.keywords.some(keyword=>

keyword.includes(query)

)

);

});

loadProducts(filtered);

}
/* ============================================================
                FILTER
============================================================ */

function filterProducts(category, button){

document
.querySelectorAll(".filters button")
.forEach(btn=>btn.classList.remove("active-filter"));

if(button) button.classList.add("active-filter");

if(category==="All"){

loadProducts(

products.filter(

product=>product.featured

)

);

return;

}

const filtered=products.filter(product=>

product.category===category || product.subcategory===category

);

loadProducts(filtered);

}

function getProductsByCategory(category){

    const importedBrands=[

        "Monster",

        "Prime",

        "Nutella",

        "Lotus",

        "Ferrero",

        "Kinder",

        "Toblerone",

        "Davidoff",

        "Georgia",

        "Pringles"

    ];

    if(category==="Imported"){

        return products.filter(product=>

            product.category==="Imported" || importedBrands.includes(product.brand)

        );

    }

    if(category==="Personal Care"){

        return products.filter(product=>

            [

                "Hair Care",

                "Bath & Body",

                "Skin Care",

                "Oral Care",

                "Men's Grooming",

                "Fragrances"

            ].includes(product.category)

        );

    }

    return products.filter(

        product=>product.category===category

    );

}

/* =====================================================
            CATEGORY DRAWER
===================================================== */

function openCategory(category){

    const drawer = document.getElementById("categoryDrawer");
    const overlay = document.getElementById("drawerOverlay");
    const title = document.getElementById("drawerTitle");
    const content = document.getElementById("drawerContent");

    title.innerText = category;

    const items = getProductsByCategory(category);
    content.innerHTML = "";

    if(items.length===0){

        content.innerHTML = `

            <div class="empty-category">

                <h3>No products found.</h3>

                <p>Products coming soon!</p>

            </div>

        `;

    }else{

        content.innerHTML = items.map(product=>`

            <div class="drawer-item">

                <img src="${escapeProductHTML(getProductImage(product))}" alt="${escapeProductHTML(product.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${productImageFallback}'">

                <div class="drawer-info">

                    <h3>${escapeProductHTML(product.name)}</h3>

                    <p>${escapeProductHTML(product.brand)}</p>

                    <span>₹${product.price}</span>

                </div>

                <button onclick="openProduct(${product.id})" ${product.available===false ? "disabled" : ""}>

                    ${product.available===false ? "Currently unavailable" : "Buy"}

                </button>

            </div>

            `).join("");

    }

    drawer.classList.add("show");
    overlay.classList.add("show");

}

function closeDrawer(){

    document
    .getElementById("categoryDrawer")
    .classList.remove("show");

    document
    .getElementById("drawerOverlay")
    .classList.remove("show");

}
document.querySelectorAll(".category-card").forEach(card => {

    card.addEventListener("click", () => {

        const category = card.dataset.category;

        openCategory(category);

    });

});

function updateCategoryCounts(){

document

.querySelectorAll(".category-card")

.forEach(card=>{

const category=

card.dataset.category;

const count=

getProductsByCategory(category).length;

card.querySelector(

".category-count"

).innerText=

`${count} Products`;

});

}
/* ============================================================
                WHATSAPP
============================================================ */

function orderProduct(){

const title=document.getElementById("popupTitle").innerText;

const quantity=document.getElementById("quantity").value;

const message=

`Hi Vinayak Superstore!

I would like to order

${title}

Quantity : ${quantity}

Please confirm availability.

Thank You.`;

window.open(

`https://wa.me/919779562555?text=${encodeURIComponent(message)}`,

"_blank"

);

}

/* ============================================================
                INITIAL LOAD
============================================================ */


loadProducts(

products.filter(

p=>p.featured

)

);

updateCategoryCounts();

document.addEventListener("wishlist:updated",()=>{

    document.querySelectorAll(".wishlist-icon").forEach(button=>{

        const onclick=button.getAttribute("onclick");

        const id=parseInt(
            onclick.match(/\d+/)[0]
        );

        const icon=button.querySelector("i");

        if(isWishlisted(id)){

            icon.className="fa-solid fa-heart";

        }else{

            icon.className="fa-regular fa-heart";

        }

    });

});
/* ============================================================
                COLLECTION ENGINE
============================================================ */

function renderCollection(

containerId,

title,

filterFunction,

limit=4

){

    const container=document.getElementById(containerId);

    if(!container) return;

    const items=products

        .filter(filterFunction)

        .slice(0,limit);

    container.innerHTML=`

        <div class="collection-header">

            <h2>${title}</h2>

            <button class="view-all-btn">

                View All →

            </button>

        </div>

        <div class="collection-grid">

            ${items.map(product=>`

            <article class="product-card">

                <div class="card-top">

                    <button

                    class="wishlist-icon"

                    onclick="event.stopPropagation();toggleWishlist(${product.id})">

                    <i class="${
                        isWishlisted(product.id)
                        ?"fa-solid"
                        :"fa-regular"
                    } fa-heart"></i>

                    </button>

                </div>

                <img src="${escapeProductHTML(getProductImage(product))}" alt="${escapeProductHTML(product.name)}">

                ${getProductOffer(product) ? `<span class="offer-pill">${escapeProductHTML(getProductOffer(product))}</span>` : ''}

                <div class="rating">

                    ⭐ ${product.rating}

                </div>

                <h3>${escapeProductHTML(product.name)}</h3>

                <p>${escapeProductHTML(product.description)}</p>

                <div class="price-stock">

                    <h4>₹${product.price}</h4>

                    <span class="stock ${product.available===false ? "unavailable" : ""}">${product.available===false ? "Currently unavailable" : (product.stock>10 ? "In Stock" : (product.stock>0 ? "Low Stock" : "In Stock"))}</span>

                </div>

                <button

                class="view-btn"

                onclick="openProduct(${product.id})">

                👁 Quick View

                </button>

            </article>

            `).join("")}

        </div>

    `;

}

function renderCollections(){
renderCollection(

"bestSellerCollection",

"🔥 Best Sellers",

p=>p.featured

);

renderCollection(

"importedCollection",

"🌍 Imported Collection",

p=>

[

"Nutella",

"Lotus",

"Davidoff",

"Kinder",

"Toblerone",

"Pringles",

"Georgia"

]

.includes(p.brand)

);

renderCollection(

"energyCollection",

"⚡ Energy Drinks",

p=>p.category==="Energy Drinks"

);

renderCollection(

"chocolateCollection",

"🍫 Chocolate Heaven",

p=>p.category==="Chocolates"

);


}

function addDynamicCategoryCards(){
    const categoryGrid=document.querySelector('.category-grid');
    if(!categoryGrid) return;
    const existing=new Set([...categoryGrid.querySelectorAll('.category-card')].map(card=>card.dataset.category));
    [...new Set(products.map(product=>product.category))].sort((a,b)=>a.localeCompare(b)).forEach(category=>{
        if(existing.has(category)) return;
        const card=document.createElement('article'); card.className='category-card'; card.dataset.category=category;
        const icon=document.createElement('i'); icon.className='fa-solid fa-basket-shopping'; icon.setAttribute('aria-hidden','true');
        const title=document.createElement('h3'); title.textContent=category;
        const count=document.createElement('p'); count.className='category-count';
        const link=document.createElement('span'); link.textContent='View Collection →';
        card.append(icon,title,count,link); card.addEventListener('click',()=>openCategory(category)); categoryGrid.append(card);
    });
}

function refreshCatalogViews(){
    loadProducts(products.filter(product=>product.featured));
    addDynamicCategoryCards();
    updateCategoryCounts();
    renderCollections();
    if(typeof renderWishlist==='function') renderWishlist();
}

renderCollections();
async function fetchProductCatalogue(url){
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok) throw new Error(`Could not load the product catalogue from ${url}.`);
    const records=await response.json();
    if(!Array.isArray(records)||!records.length||records.some(product=>!product||product.id===undefined||!product.name||!product.category)){
        throw new Error(`The product catalogue from ${url} is invalid.`);
    }
    return records;
}

window.productsReady=(async()=>{
    let records;
    try{
        records=await fetchProductCatalogue('/api/products');
    }catch(apiError){
        // Static preview servers such as VS Code Live Server cannot provide the API.
        // Use the public snapshot there; the Python service remains the live source of truth.
        records=await fetchProductCatalogue('data/products.json');
    }
    products.splice(0,products.length,...records);
    refreshCatalogViews();
    return products;
})().catch(error=>{
    console.error(error);
    if(grid) grid.innerHTML='<p class="catalogue-error">The product catalogue could not be loaded. Please refresh in a moment.</p>';
    return [];
});
