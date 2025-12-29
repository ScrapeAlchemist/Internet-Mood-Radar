/**
 * Translations for the Internet Mood Radar app
 * Supported languages: English (en), Hebrew (he), Russian (ru)
 */

export type AppLanguage = 'en' | 'he' | 'ru';

export interface Translations {
  // App title and header
  appTitle: string;

  // Time windows
  timeWindow1h: string;
  timeWindow6h: string;
  timeWindow24h: string;

  // Stats
  tensionIndex: string;
  topics: string;
  sources: string;
  events: string;

  // Buttons and controls
  allNews: string;
  showSummary: string;
  hideSummary: string;
  settings: string;
  save: string;
  cancel: string;
  scan: string;
  scanning: string;
  close: string;

  // Settings modal
  settingsTitle: string;
  language: string;
  country: string;
  regions: string;
  countriesAndRegions: string;
  categories: string;
  searchQueries: string;
  urlsToScrape: string;
  sourcesPerCategory: string;
  estimatedCost: string;

  // Categories
  categoryNews: string;
  categorySocial: string;
  categoryTech: string;
  categoryEvents: string;
  categoryWeather: string;

  // News feed
  newsFeedTitle: string;
  searchPlaceholder: string;
  all: string;
  noResults: string;
  noItems: string;

  // Map
  loadingMap: string;

  // Time ago
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;

  // Errors
  errorLoading: string;
  retry: string;
}

const en: Translations = {
  appTitle: 'Internet Mood Radar',

  timeWindow1h: '1h',
  timeWindow6h: '6h',
  timeWindow24h: '24h',

  tensionIndex: 'Tension',
  topics: 'Topics',
  sources: 'Sources',
  events: 'Events',

  allNews: 'All News',
  showSummary: 'Show Summary',
  hideSummary: 'Hide Summary',
  settings: 'Settings',
  save: 'Save',
  cancel: 'Cancel',
  scan: 'Scan',
  scanning: 'Scanning...',
  close: 'Close',

  settingsTitle: 'Settings',
  language: 'Language',
  country: 'Country',
  regions: 'Regions',
  countriesAndRegions: 'Countries & Regions',
  categories: 'Categories',
  searchQueries: 'Search Queries (per region)',
  urlsToScrape: 'URLs to Scrape (per region)',
  sourcesPerCategory: 'Sources per Category',
  estimatedCost: 'Estimated Cost per Scan',

  categoryNews: 'News',
  categorySocial: 'Social',
  categoryTech: 'Tech',
  categoryEvents: 'Events',
  categoryWeather: 'Weather',

  newsFeedTitle: 'All News',
  searchPlaceholder: 'Search news...',
  all: 'All',
  noResults: 'No matching results',
  noItems: 'No items in this category',

  loadingMap: 'Loading map...',

  minutesAgo: 'm ago',
  hoursAgo: 'h ago',
  daysAgo: 'd ago',

  errorLoading: 'Error loading data',
  retry: 'Retry',
};

const he: Translations = {
  appTitle: 'מד מצב רוח האינטרנט',

  timeWindow1h: 'שעה',
  timeWindow6h: '6 שעות',
  timeWindow24h: '24 שעות',

  tensionIndex: 'מתח',
  topics: 'נושאים',
  sources: 'מקורות',
  events: 'אירועים',

  allNews: 'כל החדשות',
  showSummary: 'הצג סיכום',
  hideSummary: 'הסתר סיכום',
  settings: 'הגדרות',
  save: 'שמור',
  cancel: 'ביטול',
  scan: 'סרוק',
  scanning: 'סורק...',
  close: 'סגור',

  settingsTitle: 'הגדרות',
  language: 'שפה',
  country: 'מדינה',
  regions: 'אזורים',
  countriesAndRegions: 'מדינות ואזורים',
  categories: 'קטגוריות',
  searchQueries: 'שאילתות חיפוש (לאזור)',
  urlsToScrape: 'כתובות לסריקה (לאזור)',
  sourcesPerCategory: 'מקורות לקטגוריה',
  estimatedCost: 'עלות משוערת לסריקה',

  categoryNews: 'חדשות',
  categorySocial: 'חברתי',
  categoryTech: 'טכנולוגיה',
  categoryEvents: 'אירועים',
  categoryWeather: 'מזג אוויר',

  newsFeedTitle: 'כל החדשות',
  searchPlaceholder: 'חיפוש חדשות...',
  all: 'הכל',
  noResults: 'לא נמצאו תוצאות',
  noItems: 'אין פריטים בקטגוריה זו',

  loadingMap: 'טוען מפה...',

  minutesAgo: 'ד׳ ',
  hoursAgo: 'ש׳ ',
  daysAgo: 'י׳ ',

  errorLoading: 'שגיאה בטעינת נתונים',
  retry: 'נסה שוב',
};

const ru: Translations = {
  appTitle: 'Радар настроений интернета',

  timeWindow1h: '1ч',
  timeWindow6h: '6ч',
  timeWindow24h: '24ч',

  tensionIndex: 'Напряжение',
  topics: 'Темы',
  sources: 'Источники',
  events: 'События',

  allNews: 'Все новости',
  showSummary: 'Показать сводку',
  hideSummary: 'Скрыть сводку',
  settings: 'Настройки',
  save: 'Сохранить',
  cancel: 'Отмена',
  scan: 'Сканировать',
  scanning: 'Сканирование...',
  close: 'Закрыть',

  settingsTitle: 'Настройки',
  language: 'Язык',
  country: 'Страна',
  regions: 'Регионы',
  countriesAndRegions: 'Страны и регионы',
  categories: 'Категории',
  searchQueries: 'Запросов (на регион)',
  urlsToScrape: 'URL (на регион)',
  sourcesPerCategory: 'Источников на категорию',
  estimatedCost: 'Стоимость сканирования',

  categoryNews: 'Новости',
  categorySocial: 'Соцсети',
  categoryTech: 'Технологии',
  categoryEvents: 'События',
  categoryWeather: 'Погода',

  newsFeedTitle: 'Все новости',
  searchPlaceholder: 'Поиск новостей...',
  all: 'Все',
  noResults: 'Результаты не найдены',
  noItems: 'Нет элементов в этой категории',

  loadingMap: 'Загрузка карты...',

  minutesAgo: 'м назад',
  hoursAgo: 'ч назад',
  daysAgo: 'д назад',

  errorLoading: 'Ошибка загрузки данных',
  retry: 'Повторить',
};

export const translations: Record<AppLanguage, Translations> = {
  en,
  he,
  ru,
};

export function getTranslations(language: AppLanguage): Translations {
  return translations[language] || translations.en;
}

/**
 * Get the text direction for a language
 */
export function getTextDirection(language: AppLanguage): 'ltr' | 'rtl' {
  return language === 'he' ? 'rtl' : 'ltr';
}

/**
 * Language display names (in their own language)
 */
export const languageNames: Record<AppLanguage, string> = {
  en: 'English',
  he: 'עברית',
  ru: 'Русский',
};
