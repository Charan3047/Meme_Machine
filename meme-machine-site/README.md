# Meme Machine promotional website

A standalone, responsive landing page for introducing Meme Machine, explaining the two game modes, and sending visitors to the live game. It uses plain HTML, CSS, and browser JavaScript; no build step or package installation is needed.

## Public pages and routes

- `/` — promotional home page
- `/about` — project and publisher information
- `/how-to-play` — quick-start and scoring guide
- `/privacy-policy` — current data and future advertising disclosures
- `/cookie-policy` — browser storage and future ad-cookie information
- `/terms` — terms of use
- `/contact` — support and privacy contact route

Vercel rewrites the clean routes to the static HTML files. Legacy paths such as `/privacy`, `/cookies`, and `.html` links redirect to the clean URLs.

## Preview locally

Open `index.html` in a browser. For a local web server, run `npx serve .` from this folder.

## Publish on Vercel

1. Push the `meme-machine-site` folder to the existing GitHub repository.
2. In Vercel, create a second project and import the same repository.
3. Set **Root Directory** to `meme-machine-site`.
4. Use the **Other** framework preset. Leave build and install commands blank; the site is static.
5. Deploy, then add a domain in **Settings → Domains** if you have one.

## Before sharing the deployed address

- Replace the `https://memeachine.vercel.app/og-image.png` image references in `index.html` if the game branding asset moves.
- Add a canonical link using the final promotional-site domain in `index.html`.
- Create `sitemap.xml` with that final domain and add its sitemap URL to `robots.txt`.
- The large social preview image is served from the existing game at `https://memeachine.vercel.app/og-image.png`.
- Replace `[ADD A WORKING PRIVACY CONTACT EMAIL]` on the Privacy and Contact pages with a monitored private email address. The publisher name is currently set to Charan Teja; confirm it is the legal publisher name.
- If AdSense is enabled, update the Privacy Policy with every actual ad technology vendor and its privacy/opt-out links. Add only the publisher-specific `ads.txt` record provided by AdSense.
- Before serving personalized Google ads to users in the EEA, UK, or Switzerland, configure a Google-certified CMP integrated with the IAB TCF. Do not place ads where gameplay or private room communications are the page’s primary content, and never encourage ad clicks.

These pages document the project and current data practices, but they do not guarantee AdSense approval. Google reviews the whole site, actual content, traffic and implementation. See the current [required privacy disclosures](https://support.google.com/adsense/answer/1348695), [publisher policies](https://support.google.com/adsense/answer/10502938), and [regional consent requirements](https://support.google.com/adsense/answer/13554116).

The **Play now** links intentionally lead to the live game at `https://memeachine.vercel.app/`.
