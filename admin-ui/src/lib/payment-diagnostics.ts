export interface PaymentProviderDiagnostic {
  enabled: boolean;
  configured: boolean;
  available: boolean | null;
  checkedAt: string | null;
  message: string;
  errorCode?: string | null;
  availableMethods?: string[];
}

export interface PaymentWebhookDiagnostic {
  configured: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
}

export interface PaymentDiagnostics {
  canManage: boolean;
  checkedAt: string | null;
  mode: {
    widgetEnabled: boolean;
    effectiveIntegration: 'widget' | 'hosted_page' | null;
    fallbackActive: boolean;
    fallbackReason: string | null;
    updatedAt: string | null;
  };
  providers: {
    kaspi: PaymentProviderDiagnostic;
    forteHosted: PaymentProviderDiagnostic;
    forteWidget: PaymentProviderDiagnostic;
  };
  webhooks: {
    kaspi: PaymentWebhookDiagnostic;
    forteWidget: PaymentWebhookDiagnostic;
  };
  cleanup: {
    checkedAt: string | null;
    inspected: number;
    expired: number;
    cancelled: number;
    released: number;
    errors: number;
  };
  latestErrors: Array<{
    id: string;
    orderNumber: number | null;
    provider: string;
    status: string;
    message: string;
    occurredAt: string | null;
  }>;
}
