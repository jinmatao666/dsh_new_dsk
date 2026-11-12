"""Server-side business billing client. Reuse the expert's existing identity exchange.

No administrator token or per-feature secret is configured. Keep the redeemed
identity and this client in the authenticated server session, never in browser storage.
"""
from dataclasses import dataclass, field
from decimal import Decimal
import json
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler


class BillingError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class BillingTask:
    id: str
    state: str
    _token: str = field(repr=False)


class Billing:
    """One instance per redeemed user session, not a global process singleton."""
    def __init__(self, base_url, identity):
        self._base = base_url.rstrip("/") + "/api/billing/v1"
        self._context = identity["billing_context"]
        if not isinstance(self._context, str) or not self._context.startswith("wbc_"):
            raise BillingError("MISSING_BILLING_CONTEXT")
        self._opener = build_opener(_NoRedirect())

    def _call(self, path, body=None, token=None):
        request = Request(
            self._base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + (token or self._context),
                     "Content-Type": "application/json"},
            method="POST" if body is not None else "GET",
        )
        try:
            with self._opener.open(request, timeout=10) as response:
                result = json.load(response)
        except HTTPError as error:
            try:
                code = json.load(error).get("code", "BILLING_HTTP_ERROR")
            except (ValueError, AttributeError):
                code = "BILLING_HTTP_ERROR"
            raise BillingError(code) from None
        if result.get("success") is not True:
            raise BillingError(result.get("code", "BILLING_FAILED"))
        return result

    def _reserve(self, body):
        result = self._call("/tasks", body)
        token = result.get("task_token")
        if not token:
            raise BillingError("EXISTING_TASK_QUERY_BEFORE_RETRY")
        return BillingTask(result["data"]["id"], result["data"]["state"], token)

    def reserve(self, operation_id, points, description, action="custom"):
        """Reserve a developer-defined total cost (0..1000 credits); no admin rule required."""
        amount = Decimal(str(points))
        if not amount.is_finite() or not 0 <= amount <= 1000:
            raise BillingError("INVALID_POINTS")
        return self._reserve({
            "mode": "developer", "action": action, "points": format(amount, "f"),
            "description": description, "request_id": operation_id,
        })

    def reserve_default(self, operation_id, action="default", quantity=1):
        """Read the platform-configured price instead of supplying points."""
        result = self._call("/quote?" + urlencode({"action": action}))
        rule = result["data"]["rule"]
        return self._reserve({
            "mode": "configured", "action": action, "quantity": quantity,
            "version": rule["version"], "request_id": operation_id,
        })

    def confirm(self, task):
        return self._call("/tasks/" + quote(task.id, safe="") + "/result",
                          {"status": "succeeded"}, task._token)["data"]

    def cancel(self, task):
        return self._call("/tasks/" + quote(task.id, safe="") + "/result",
                          {"status": "cancelled"}, task._token)["data"]

    def fail(self, task):
        return self._call("/tasks/" + quote(task.id, safe="") + "/result",
                          {"status": "failed"}, task._token)["data"]

    def get(self, task_id):
        return self._call("/tasks/" + quote(task_id, safe=""))["data"]
