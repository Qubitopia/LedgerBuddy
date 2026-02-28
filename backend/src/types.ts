export type Bindings = {
  DB: D1Database;
  APP_NAME: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  HIVEMQ_PUBLISH_ENDPOINT: string;
  HIVEMQ_USERNAME: string;
  HIVEMQ_PASSWORD: string;
  MQTT_TOPIC_PREFIX: string;
  DEVICE_SHARED_TOKEN: string;
  DEEPGRAM_API_KEY: string;
  GEMINI_API_KEY: string;
  GOOGLE_TTS_API_KEY: string;
  DEFAULT_TZ: string;
  DEFAULT_CURRENCY: string;
};

export type AppContext = {
  Bindings: Bindings;
};
