"""Tollbugata Profits – ukescreen for Oslo Børs."""

from .data import DataSourceError, Universe, fetch_universe, parse_payload
from .logic import Criteria, ScreenResult, screen, sort_stocks
from .markets import (
    GrowthList,
    MarketDataSourceError,
    fetch_growth_tickers,
    parse_growth_payload,
)
from .models import Stock
from .news import (
    NewsFeed,
    NewsItem,
    aggregate_sentiment,
    classify_sentiment,
    fetch_news,
    last_market_open,
    news_window_start,
)
from .strategy import Candidate, rank_candidates

__all__ = [
    "Candidate",
    "Criteria",
    "DataSourceError",
    "NewsFeed",
    "NewsItem",
    "ScreenResult",
    "Stock",
    "Universe",
    "aggregate_sentiment",
    "classify_sentiment",
    "fetch_news",
    "fetch_universe",
    "last_market_open",
    "news_window_start",
    "parse_payload",
    "rank_candidates",
    "screen",
    "sort_stocks",
]

__version__ = "1.0.0"
