export type OperatorOrderStatus = "new" | "in_progress" | "awaiting_customer" | "completed" | "cancelled";

type StatusBearingOrder = { status: OperatorOrderStatus };

export type OperatorOrderSummary = {
  total: number;
  new: number;
  inProgress: number;
  awaitingCustomer: number;
  completed: number;
  cancelled: number;
  needsAttention: number;
};

/**
 * Summarises the orders already returned by the authenticated admin bootstrap.
 * It deliberately does not infer sales, traffic, or other unavailable metrics.
 */
export function summarizeOperatorOrders(orders: StatusBearingOrder[]): OperatorOrderSummary {
  const summary: OperatorOrderSummary = {
    total: orders.length,
    new: 0,
    inProgress: 0,
    awaitingCustomer: 0,
    completed: 0,
    cancelled: 0,
    needsAttention: 0,
  };

  for (const order of orders) {
    switch (order.status) {
      case "new":
        summary.new += 1;
        summary.needsAttention += 1;
        break;
      case "in_progress":
        summary.inProgress += 1;
        break;
      case "awaiting_customer":
        summary.awaitingCustomer += 1;
        summary.needsAttention += 1;
        break;
      case "completed":
        summary.completed += 1;
        break;
      case "cancelled":
        summary.cancelled += 1;
        break;
    }
  }

  return summary;
}
