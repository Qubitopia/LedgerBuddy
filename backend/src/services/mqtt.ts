import type { Bindings } from "../types";
import type { PaymentNotification } from "../contracts/events";

export async function publishPaymentNotification(env: Bindings, notification: PaymentNotification): Promise<void> {
  const topic = `${env.MQTT_TOPIC_PREFIX}/${notification.deviceId}/payment-events`;
  const payload = JSON.stringify(notification);

  const response = await fetch(env.HIVEMQ_PUBLISH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${env.HIVEMQ_USERNAME}:${env.HIVEMQ_PASSWORD}`)}`
    },
    body: JSON.stringify({ topic, qos: 1, retain: false, payload })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MQTT publish failed: ${response.status} ${body}`);
  }
}
