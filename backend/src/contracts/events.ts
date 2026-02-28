export type PaymentNotification = {
  type: "payment_credited";
  eventId: string;
  deviceId: string;
  amountPaise: number;
  currency: string;
  paidAt: string;
};

export type VoiceCommandResponse = {
  commandId: string;
  transcript: string;
  intentId: number;
  responseText: string;
};
