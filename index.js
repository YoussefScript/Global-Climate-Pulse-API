const PORT = process.env.PORT || 8000;
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const rateLimit = require("express-rate-limit");

const app = express();

// In-memory cache store to eliminate live scraping delays and prevent redundant requests
let cachedArticles = [];
let lastFetchedTime = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

// Define rate limiter: maximum 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message:
        "Too many requests from this IP, please try again after 15 minutes.",
    },
  },
});

// Apply the rate limiter to all requests starting with /news
app.use("/news", limiter);

// API Key Authentication Middleware for RapidAPI / Commercial deployment
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.header("x-rapidapi-key") || req.header("x-api-key");

  if (!apiKey) {
    return res.status(401).json({
      error: {
        code: "MISSING_API_KEY",
        message: "Access denied. No API key provided.",
      },
    });
  }

  next();
};

const newspapers = [
  {
    name: "cityam",
    address:
      "https://www.cityam.com/london-must-become-a-world-leader-on-climate-change-action/",
    base: "",
  },
  {
    name: "thetimes",
    address: "https://www.thetimes.co.uk/environment/climate-change",
    base: "https://www.thetimes.co.uk",
  },
  {
    name: "guardian",
    address: "https://www.theguardian.com/environment/climate-crisis",
    base: "",
  },
  {
    name: "nyt",
    address: "https://www.nytimes.com/international/section/climate",
    base: "https://www.nytimes.com",
  },
  {
    name: "latimes",
    address: "https://www.latimes.com/environment",
    base: "",
  },
  {
    name: "smh",
    address: "https://www.smh.com.au/environment/climate-change",
    base: "https://www.smh.com.au",
  },
  {
    name: "un",
    address: "https://www.un.org/climatechange",
    base: "",
  },
  {
    name: "bbc",
    address: "https://www.bbc.co.uk/news/science_and_environment",
    base: "https://www.bbc.co.uk",
  },
  {
    name: "es",
    address: "https://www.standard.co.uk/topic/climate-change",
    base: "https://www.standard.co.uk",
  },
  {
    name: "sun",
    address: "https://www.thesun.co.uk/topic/climate-change-environment/",
    base: "",
  },
  {
    name: "dm",
    address:
      "https://www.dailymail.co.uk/news/climate_change_global_warming/index.html",
    base: "https://www.dailymail.co.uk",
  },
  {
    name: "nyp",
    address: "https://nypost.com/tag/climate-change/",
    base: "",
  },
];

// Function to fetch and update the cache in the background
const fetchNews = () => {
  return new Promise((resolve) => {
    const articles = [];
    let completedRequests = 0;
    const keywords = [
      "climate",
      "environment",
      "warming",
      "weather",
      "drought",
      "carbon",
    ];
    const currentYear = new Date().getFullYear();

    newspapers.forEach((newspaper) => {
      axios
        .get(newspaper.address, {
          timeout: 10000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        })
        .then((response) => {
          const html = response.data;
          const $ = cheerio.load(html);

          $("a", html).each(function () {
            const title = $(this).text().trim();
            let url = $(this).attr("href");

            if (!url) return;

            url = url.startsWith("http") ? url : newspaper.base + url;

            const matchesKeyword = keywords.some((keyword) =>
              title.toLowerCase().includes(keyword),
            );

            const isArticle =
              url.includes(`/${currentYear}/`) ||
              url.includes("/article/") ||
              url.includes("/news/") ||
              url.includes("/money/") ||
              url.includes("/business/") ||
              url.includes("/politics/") ||
              url.includes("/world/");

            if (
              title &&
              matchesKeyword &&
              isArticle &&
              !url.includes("tabs-popular")
            ) {
              articles.push({
                title,
                url,
                source: newspaper.name,
              });
            }
          });
        })
        .catch((err) =>
          console.log(`Error fetching ${newspaper.name}:`, err.message),
        )
        .finally(() => {
          completedRequests++;
          if (completedRequests === newspapers.length) {
            const uniqueArticles = Array.from(
              new Set(articles.map((a) => a.url)),
            ).map((url) => {
              return articles.find((a) => a.url === url);
            });
            cachedArticles = uniqueArticles;
            lastFetchedTime = Date.now();
            console.log(
              `[Cache Updated] Successfully stored ${cachedArticles.length} articles.`,
            );
            resolve(cachedArticles);
          }
        });
    });
  });
};

app.get("/", (req, res) => {
  res.json("Welcome to my climate change news API");
});

app.get("/news", apiKeyAuth, async (req, res) => {
  const isCacheExpired =
    !lastFetchedTime || Date.now() - lastFetchedTime > CACHE_DURATION;

  if (cachedArticles.length === 0 || isCacheExpired) {
    console.log("Cache is empty or expired. Fetching fresh news...");
    const freshArticles = await fetchNews();
    return res.json(freshArticles);
  }

  console.log("Serving results from cache.");
  res.json(cachedArticles);
});

app.get("/news/:newspaperId", apiKeyAuth, async (req, res) => {
  const newspaperId = req.params.newspaperId;

  const filteredNewspaper = newspapers.filter(
    (newspaper) => newspaper.name == newspaperId,
  );

  if (filteredNewspaper.length === 0) {
    return res.status(404).json({ error: "Newspaper not found" });
  }

  const isCacheExpired =
    !lastFetchedTime || Date.now() - lastFetchedTime > CACHE_DURATION;
  if (cachedArticles.length === 0 || isCacheExpired) {
    await fetchNews();
  }

  const sourceArticles = cachedArticles.filter(
    (article) => article.source === newspaperId,
  );
  res.json(sourceArticles);
});

app.listen(PORT, () => {
  console.log(`server running on PORT ${PORT}`);
  // Initial fetch on server start to populate cache immediately
  fetchNews();
});
