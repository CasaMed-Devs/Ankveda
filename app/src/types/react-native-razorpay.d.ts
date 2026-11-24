declare module 'react-native-razorpay' {
  export type RazorpayCheckoutOptions = {
    key: string;
    subscription_id?: string;
    order_id?: string;
    amount?: number;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    recurring?: boolean;
    prefill?: { contact?: string; email?: string; name?: string };
    theme?: { color?: string };
    notes?: Record<string, string>;
  };

  export type RazorpaySuccess = {
    razorpay_payment_id: string;
    razorpay_subscription_id?: string;
    razorpay_order_id?: string;
    razorpay_signature: string;
  };

  export type RazorpayFailure = { code: number; description: string; error?: { reason?: string } };

  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccess>;
  };

  export default RazorpayCheckout;
}
