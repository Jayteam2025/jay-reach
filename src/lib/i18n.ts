import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/translation.json';
import fr from '../locales/fr/translation.json';
import nl from '../locales/nl/translation.json';

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  nl: { translation: nl },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'fr', // Default language, will be overridden by user profile
    fallbackLng: 'fr',
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

export default i18n;
