import { assert } from "https://deno.land/std@0.93.0/_util/assert.ts";
import puppeteer, { HTTPRequest, Page } from 'https://deno.land/x/puppeteer@16.2.0/mod.ts'

const COOKIE_FILE = './cookies.json'

if (import.meta.main) {
    await main(Deno.args)
}

async function main(args: string[]) {
    const urls = args
    if (urls.length === 0) {
        console.log('No URLs provided.')
        return
    }

    const loginUrl = Deno.env.get('login_url')
    assert(loginUrl?.length ?? 0 > 0, 'No login URL provided.')
    const loggedInSelector = Deno.env.get('logged_in_selector')
    assert(loggedInSelector?.length ?? 0 > 0, 'No logged in selector provided.')
    const cdnIdentifier = Deno.env.get('cdn_identifier')
    assert(cdnIdentifier !== undefined, 'No CDN identifier provided.')
    const loginParams = {
        loginUrl: loginUrl!,
        loggedInSelector: loggedInSelector!,
    }
    await process({ urls, loginParams, cdnIdentifier, })
}

type processParams = {
    urls: string[]
    loginParams: getLoggedInPageParams
    cdnIdentifier: string
}
async function process({
    urls,
    loginParams,
    cdnIdentifier,
}: processParams) {
    const { browser, page } = await getLoggedInPage(loginParams)

    const results: {
        url: string,
        title: string,
        m3u8Urls: string[],
    }[] = []
    for (const url of urls) {
        const result = await getIFrameM3u8Urls({ page, url, cdnIdentifier, })
        results.push({ url, ...result, })
    }

    await browser.close();
}

async function loadCookies(page: Page) {
    try {
        const cookies = JSON.parse(await Deno.readTextFile(COOKIE_FILE));
        await page.setCookie(...cookies);
        return true
    } catch (error) {
        console.log({ msg: 'No saved cookies found, proceeding without.', error, })
        return false
    }
}

async function saveCookies(page: Page) {
    const cookies = await page.cookies();
    await Deno.writeTextFile(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log('Cookies saved successfully.');
}

type getLoggedInPageParams = {
    loginUrl: string
    loggedInSelector: string
}
async function getLoggedInPage({
    loginUrl,
    loggedInSelector,
}: getLoggedInPageParams) {
    const browser = await puppeteer.launch({
        args: ['--disable-features=site-per-process',],
        executablePath: `C:/Program Files/Google/Chrome/Application/chrome.exe`,
        headless: false,
    })
    const page = await browser.newPage()

    const loadedCookies = await loadCookies(page)
    if (!loadedCookies) {
        await page.goto(loginUrl)

        await Promise.race([
            page.waitForNavigation({ timeout: 2 * 60 * 1000, }),
            page.waitForSelector(loggedInSelector),
        ]);

        console.log('Login detected, saving cookies...')
        await saveCookies(page)
    }
    return {
        browser,
        page,
    }
}

type getIFrameM3u8UrlsParams = {
    page: Page
    url: string
    cdnIdentifier: string
}
async function getIFrameM3u8Urls({
    page,
    url,
    cdnIdentifier,
}: getIFrameM3u8UrlsParams) {
    const m3u8Urls: string[] = []
    const cdnSites: string[] = []

    const ignorePrefixes = new Map<string, number>()
    for (const ignore of ['data:image']) {
        ignorePrefixes.set(ignore, 0)
    }
    const ignoreExtensions = new Map<string, number>()
    for (const ignore of ['.css', '.jpg', '.js', '.php', '.png', '.woff2']) {
        ignoreExtensions.set(ignore, 0)
    }
    const collectRequests = (eventName: string) => (event: HTTPRequest) => {
        const request = event
        const frame = request.frame()

        const url = request.url()

        for (const [ prefix, count ] of ignorePrefixes) {
            if (url.startsWith(prefix)) {
                ignorePrefixes.set(prefix, count + 1)
                return
            }
        }

        const urlPath = url.replace(/\?.*$/, '')
        const lastDot = urlPath.lastIndexOf('.')
        const ext = lastDot === -1 ? '' : urlPath.slice(lastDot)
        if (ignoreExtensions.has(ext)) {
            ignoreExtensions.set(ext, ignoreExtensions.get(ext)! + 1)
            return
        }

        if (url.includes('.m3u8')) {
            console.log(`${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
            m3u8Urls.push(url)
        } else if (url.includes(cdnIdentifier)) {
            console.log(`cdn ${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
            cdnSites.push(url)
        } else {
            console.log(`ignored ${eventName}:${request.resourceType()}:[${frame?.url()}] → ${url}`)
        }
    }

    const events = [
        ['request', collectRequests('request')],
        ['requestfinished', collectRequests('requestfinished')],
        ['requestfailed', collectRequests('requestfailed')],
        ['requestservedfromcache', collectRequests('requestservedfromcache')],
    ] as const

    for (const [ eventName, handler ] of events) {
        page.on(eventName, handler)
    }

    page.on('request', collectRequests('request'))
    page.on('requestfinished', collectRequests('requestfinished'))
    page.on('requestfailed', collectRequests('requestfailed'))
    page.on('requestservedfromcache', collectRequests('requestservedfromcache'))

    page.goto(url)

    const start = Date.now()
    const promiseResult = await Promise.allSettled([
        // wait for all page resources to load
        Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' })
                .then(() => ({
                    time: Date.now() - start,
                    promise: 'waitForNavigation:networkidle2',
                })),
            page.waitForNetworkIdle()
                .then(() => ({
                    time: Date.now() - start,
                    promise: 'waitForNetworkIdle',
                })),
            page.waitForNetworkIdle({ idleTime: 500 })
                .then(() => ({
                    time: Date.now() - start,
                    promise: 'waitForNetworkIdle:idleTime=500',
                })),
        ]),
        new Promise((resolve) => setTimeout(resolve, 5000))
            .then(() => ({
                time: Date.now() - start,
                promise: 'timeout:5000',
            })),
    ])
    console.log({ promiseResult })
    console.log({
        m3u8Urls,
        cdnSites,
        ignoreExtensions,
        ignorePrefixes,
    })

    for (const [ eventName, handler ] of events) {
        page.off(eventName, handler)
    }

    const title = await page.title()

    const uniqueCdnSites = Array.from(new Set(cdnSites))
    for (let i = 0; i < uniqueCdnSites.length && m3u8Urls.length === 0; i++) {
        const cdnSite = uniqueCdnSites[i]
        console.log(`++++ Trying to find m3u8 URLs from ${cdnSite}`)
        const results = await getIFrameM3u8Urls({ page, url: cdnSite, cdnIdentifier, })
        m3u8Urls.push(...results.m3u8Urls)
    }
    return {
        title,
        m3u8Urls,
        cdnSites,
    }
}
