CREATE TABLE IF NOT EXISTS razorpay_qr_credits (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	event_id TEXT UNIQUE,
	event TEXT NOT NULL,
	payment_id TEXT,
	qr_code_id TEXT,
	amount_paise INTEGER NOT NULL,
	currency TEXT NOT NULL,
	method TEXT,
	vpa TEXT,
	status TEXT,
	paid_at_unix INTEGER NOT NULL,
	mqtt_message TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	signature TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_razorpay_qr_credits_paid_at ON razorpay_qr_credits(paid_at_unix);
CREATE INDEX IF NOT EXISTS idx_razorpay_qr_credits_payment_id ON razorpay_qr_credits(payment_id);
