const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const maxProductsArg = args.find(arg => arg.startsWith('--max-products='));
const maxProducts = maxProductsArg ? parseInt(maxProductsArg.split('=')[1], 10) : Infinity;
const verbose = args.includes('--verbose');

// Logger function that respects verbose flag
function log(...args) {
    if (verbose) {
        console.log(...args);
    }
}

// Error logging is always shown
function logError(...args) {
    console.error(...args);
}

// Normalize a beer description to compare beers regardless of container/packaging
function normalizeBeerDescription(description) {
    let normalized = (description || '').toLowerCase();
    // Normalize decimal separators
    normalized = normalized.replace(/,/g, '.');
    // Remove container / packaging terms
    normalized = normalized.replace(/\b(bouteilles?|bo[iî]tes?|canettes?|f[oô]ts?|packs?)\b/g, ' ');
    // Remove zero-alcohol percentages (0%, 0.0%, 0,0%...)
    normalized = normalized.replace(/\b0(\.0)?%/g, ' ');
    // Remove volumes (33cl, 33 cL, 1x33cl, 2L, 1.5L...)
    normalized = normalized.replace(/\b\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?\s*cl\b/gi, ' ');
    normalized = normalized.replace(/\b\d+(\.\d+)?\s*cl\b/gi, ' ');
    normalized = normalized.replace(/\b\d+(\.\d+)?\s*l\b/gi, ' ');
    // Collapse whitespace
    return normalized.replace(/\s+/g, ' ').trim();
}

// Keep the entry with the most complete data within a group
function pickBest(group) {
    return group.sort((a, b) => {
        const score = beer => (beer.ean ? 1 : 0) + (beer.nutritionalInfo?.sucres != null ? 1 : 0);
        return score(b) - score(a);
    })[0];
}

// Keep only real drinks: exclude non-beverage products (e.g. breathalyzers)
function isBeerProduct(product) {
    const text = `${product.brand} ${product.description}`.toLowerCase();
    return !text.includes('ethylotest');
}

// Merge beers that are the same product (same EAN, or same product in different containers)
function deduplicateBeers(beers) {
    // 1) Merge exact duplicates by EAN
    const eanGroups = new Map();
    for (const beer of beers) {
        if (beer.ean) {
            if (!eanGroups.has(beer.ean)) eanGroups.set(beer.ean, []);
            eanGroups.get(beer.ean).push(beer);
        }
    }

    const seenEans = new Set();
    const byEan = [];
    for (const beer of beers) {
        if (beer.ean && eanGroups.has(beer.ean)) {
            if (seenEans.has(beer.ean)) continue;
            seenEans.add(beer.ean);
            byEan.push(pickBest(eanGroups.get(beer.ean)));
        } else {
            byEan.push(beer);
        }
    }

    // 2) Merge the same beer sold in different containers by normalized description
    const groups = new Map();
    for (const beer of byEan) {
        const normalized = normalizeBeerDescription(beer.description);
        const key = `${beer.brand}::${normalized || beer.description.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(beer);
    }

    const result = [];
    for (const group of groups.values()) {
        result.push(group.length === 1 ? group[0] : pickBest(group));
    }

    return result;
}

// Open Food Facts enrichment (fallback when sucres is missing on Auchan)

const OFF_CACHE_PATH = path.join('src', '_data', 'enrichment.json');
const OFF_URL = ean => `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=code,status,nutriments`;

function loadEnrichmentCache() {
    try {
        if (fs.existsSync(OFF_CACHE_PATH)) {
            return JSON.parse(fs.readFileSync(OFF_CACHE_PATH, 'utf8'));
        }
    } catch (error) {
        logError('Could not load enrichment cache:', error.message);
    }
    return {};
}

function saveEnrichmentCache(cache) {
    const dir = path.dirname(OFF_CACHE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(OFF_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function fetchSucresFromOff(ean) {
    try {
        const res = await fetch(OFF_URL(ean), {
            headers: { 'User-Agent': 'zero-beer-sucres/1.0 (github.com/sempixel/zero)' }
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.status !== 1 || !data.product) return null;
        const sugar = data.product.nutriments && data.product.nutriments.sugars_100g;
        if (sugar === undefined || sugar === null) return null;
        const num = parseFloat(sugar);
        return isNaN(num) ? null : num;
    } catch (error) {
        logError(`Open Food Facts lookup failed for ${ean}:`, error.message);
        return null;
    }
}

// Fill missing sucres from the cache first, then Open Food Facts (and cache the result)
async function enrichMissingSucres(beers, cache) {
    const missing = beers.filter(beer => beer.ean &&
        (beer.nutritionalInfo.sucres === null || beer.nutritionalInfo.sucres === undefined));

    if (missing.length === 0) {
        console.log('No beers missing sucres, skipping Open Food Facts enrichment');
        return;
    }

    let found = 0;
    let cached = 0;
    let notFound = 0;

    for (const beer of missing) {
        const ean = String(beer.ean);

        if (ean in cache) {
            if (cache[ean] !== null) {
                beer.nutritionalInfo.sucres = cache[ean];
                cached++;
            } else {
                notFound++;
            }
            continue;
        }

        const value = await fetchSucresFromOff(ean);
        cache[ean] = value; // remember the result (even null) to avoid re-querying every run
        if (value !== null) {
            beer.nutritionalInfo.sucres = value;
            found++;
            log(`[OFF] ${beer.brand} ${beer.description} (${ean}) -> ${value}g`);
        } else {
            notFound++;
        }

        // Respect Open Food Facts rate limits
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`Open Food Facts enrichment: ${found} found, ${cached} from cache, ${notFound} not available`);
}

// Helper function to auto-scroll the page to load all products
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

const BROWSER_OPTIONS = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris'
};

// Helper function to extract EAN from product page
async function extractEAN(page) {
    try {
        return await page.evaluate(() => {
            // First try to find the EAN in the product details section
            const details = Array.from(document.querySelectorAll('div, p, span, li, td'))
                .find(el => el.textContent && el.textContent.includes('Réf / EAN :'));

            if (details) {
                const eanMatch = details.textContent.match(/Réf \/ EAN :[^\d]*(\d{13})/);
                if (eanMatch && eanMatch[1]) {
                    return eanMatch[1];
                }

                const nextSibling = details.nextElementSibling;
                if (nextSibling) {
                    const siblingEan = nextSibling.textContent.trim();
                    if (/^\d{13}$/.test(siblingEan)) {
                        return siblingEan;
                    }
                }
            }

            // Fallback: find any 13-digit number on the page
            const allText = document.body.textContent;
            const eanMatch = allText.match(/\b\d{13}\b/);
            return eanMatch ? eanMatch[0] : null;
        });
    } catch (error) {
        logError('Error extracting EAN:', error);
        return null;
    }
}

// Helper function to extract sucres with retries
async function extractSucresWithRetry(page, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await page.evaluate(() => {
                const nutritionSection = Array.from(document.querySelectorAll('h2, h3, h4, div, section'))
                    .find(el => el.textContent && el.textContent.toLowerCase().includes('valeurs nutritionnelles'));

                if (nutritionSection) {
                    const sectionText = nutritionSection.textContent;
                    const sucresMatch = sectionText.match(/sucres?[^\d]*([\d]+[.,]?[\d]*)\s*[gG]/i);

                    if (sucresMatch && sucresMatch[1]) {
                        return sucresMatch[1].replace(',', '.');
                    }

                    const sectionElement = nutritionSection.nextElementSibling ||
                        nutritionSection.parentElement;

                    if (sectionElement) {
                        const allText = sectionElement.textContent.toLowerCase();
                        const textMatch = allText.match(/sucres?[^\d]*([\d]+[.,]?[\d]*)\s*[gG]/i);
                        if (textMatch && textMatch[1]) {
                            return textMatch[1].replace(',', '.');
                        }
                    }
                }
                return null;
            });

            if (result !== null) return result;

            // If null on first attempts, wait for lazy content and retry
            if (attempt < maxRetries) {
                await page.waitForTimeout(1000 * attempt);
            }
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                await page.waitForTimeout(1000 * attempt);
            }
        }
    }

    logError(`Failed to extract sucres after ${maxRetries} attempts:`, lastError?.message || 'No data found');
    return null;
}

async function fetchBeerNames() {
    const browser = await chromium.launch({ headless: true });

    try {
        const cache = loadEnrichmentCache();
        const context = await browser.newContext(BROWSER_OPTIONS);
        const page = await context.newPage();

        console.log('Navigating to Auchan website...');
        await page.goto('https://www.auchan.fr/vins-bieres-alcool/bieres-futs-cidres/bieres-sans-alcool-panaches/ca-n071209', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        if (verbose) {
            await page.screenshot({ path: 'debug-initial.png', fullPage: true });
        }

        // Accept cookies if the banner appears
        try {
            await page.click('button#onetrust-accept-btn-handler', { timeout: 5000 });
            console.log('Accepted cookies');
        } catch (e) {
            console.log('No cookie banner found or already accepted');
        }

        console.log('Waiting for products to load...');
        try {
            await page.waitForSelector('.product-thumbnail__description', {
                timeout: 30000,
                state: 'attached'
            });
            console.log('Found products');
        } catch (error) {
            console.warn('Could not find products with primary selector, trying alternatives...');
            try {
                await page.waitForSelector([
                    '.product-card',
                    '.product-item',
                    '[data-testid*="product"]',
                    '.product-list',
                    '.product-grid',
                    '.product-container'
                ].join(','), {
                    timeout: 15000,
                    state: 'attached'
                });
            } catch (fallbackError) {
                console.warn('Could not find product container, proceeding anyway');
                if (verbose) {
                    const content = await page.content();
                    fs.writeFileSync('debug-page.html', content);
                    console.log('Saved debug-page.html');
                }
            }
        }

        console.log('Scrolling to load all products...');
        await autoScroll(page);

        // Wait for any lazy-loaded content after scroll
        await page.waitForSelector('.product-thumbnail__description', { timeout: 5000 }).catch(() => {});

        if (verbose) {
            await page.screenshot({ path: 'debug-before-extract.png', fullPage: true });
        }

        console.log('Extracting products...');

        // Get all product links and basic info
        const products = await page.$$eval('.product-thumbnail__description', elements =>
            elements.map(el => {
                const brandElement = el.querySelector('strong');
                const brand = brandElement ? brandElement.textContent.trim() : '';
                const fullText = el.textContent.trim();
                const description = brand ?
                    fullText.replace(brand, '').replace(/^\s*-?\s*/, '').trim() :
                    fullText;
                const linkElement = el.closest('a[href]');

                return {
                    brand,
                    description,
                    url: linkElement ? linkElement.href : null
                };
            })
        );

        console.log(`Found ${products.length} products`);

        await page.close();

        const numProductsToProcess = Math.min(products.length, maxProducts);
        const productsToProcess = products.slice(0, numProductsToProcess);
        console.log(`Processing ${numProductsToProcess} products${maxProducts < products.length ? ` (limited from ${products.length})` : ''}`);

        const concurrency = 5;

        for (let i = 0; i < productsToProcess.length; i += concurrency) {
            const chunk = productsToProcess.slice(i, i + concurrency);

            await Promise.all(chunk.map(async (product, chunkIndex) => {
                const productNum = i + chunkIndex + 1;
                if (!product.url) return;

                const detailPage = await context.newPage();

                try {
                    log(`[${productNum}/${numProductsToProcess}] ${product.brand} - ${product.description}`);

                    await detailPage.goto(product.url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });

                    const [ean, sucresValue] = await Promise.all([
                        extractEAN(detailPage),
                        extractSucresWithRetry(detailPage)
                    ]);

                    if (ean) {
                        log(`[${productNum}] EAN: ${ean}`);
                        product.ean = ean;
                    }

                    if (sucresValue !== null) {
                        const sucresNumber = parseFloat(sucresValue);
                        product.nutritionalInfo = {
                            sucres: isNaN(sucresNumber) ? sucresValue : sucresNumber
                        };
                    }

                    log(`[${productNum}] Sucres: ${sucresValue}`);

                } catch (error) {
                    logError(`[${productNum}] Error processing ${product.brand}:`, error.message);
                } finally {
                    await detailPage.close();
                }
            }));

            if (i + concurrency < productsToProcess.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const beersData = deduplicateBeers(products
            .filter(isBeerProduct)
            .map(product => ({
            brand: product.brand,
            description: product.description,
            ean: product.ean || null,
            nutritionalInfo: {
                sucres: product.nutritionalInfo?.sucres ?? null
            }
        })));

        const duplicatesRemoved = products.length - beersData.length;
        if (duplicatesRemoved > 0) {
            console.log(`Removed ${duplicatesRemoved} duplicate(s) (same beer in different containers)`);
        }

        beersData.sort((a, b) => {
                const aSucres = a.nutritionalInfo.sucres === null ? Infinity : a.nutritionalInfo.sucres;
                const bSucres = b.nutritionalInfo.sucres === null ? Infinity : b.nutritionalInfo.sucres;
                return aSucres - bSucres;
            });

        // Fill missing sucres (cache first, then Open Food Facts)
        await enrichMissingSucres(beersData, cache);
        saveEnrichmentCache(cache);

        // Save to src/_data/beers.json
        const dataDir = path.join('src', '_data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const beersJsonPath = path.join(dataDir, 'beers.json');
        fs.writeFileSync(beersJsonPath, JSON.stringify(beersData, null, 2));

        const metaJsonPath = path.join(dataDir, 'meta.json');
        fs.writeFileSync(metaJsonPath, JSON.stringify({ updatedAt: new Date().toISOString() }, null, 2));

        console.log(`Saved ${beersData.length} beers to ${beersJsonPath}`);

        if (verbose) {
            const logsDir = path.join('logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFilePath = path.join(logsDir, `beers-${timestamp}.json`);
            fs.writeFileSync(logFilePath, JSON.stringify(beersData, null, 2));
            log(`Saved backup to ${logFilePath}`);
        }

        return products;

    } catch (error) {
        logError('Error during scraping:', error);
        return [];
    } finally {
        await browser.close();
    }
}

(async () => {
    try {
        await fetchBeerNames();
    } catch (error) {
        logError('Unhandled error:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
})();
