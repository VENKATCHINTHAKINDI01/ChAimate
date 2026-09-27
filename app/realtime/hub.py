"""Live WebSocket fan-out: staff screens, table screens and the AI companions sitting at each table."""
import logging
from typing import TYPE_CHECKING, Any, Dict, Optional, Set

from fastapi import WebSocket

from app.core.errors import spawn

if TYPE_CHECKING:
    from app.realtime.conversation import VoiceConnection

log = logging.getLogger("main")


class Hub:
    def __init__(self) -> None:
        self.staff: Set[WebSocket] = set()
        self.tables: Dict[int, Set[WebSocket]] = {}
        self.companions: Dict[int, Set["VoiceConnection"]] = {}   # live AI conversations per table

    async def _send(self, sockets, msg: Dict[str, Any]) -> None:
        for ws in list(sockets):
            try:
                await ws.send_json(msg)
            except Exception as e:  # noqa: BLE001 — drop dead sockets
                log.debug("dropping dead socket (%s)", type(e).__name__)
                sockets.discard(ws)

    async def to_staff(self, msg: Dict[str, Any]) -> None:
        await self._send(self.staff, msg)

    async def to_table(self, table_id: int, msg: Dict[str, Any]) -> None:
        await self._send(self.tables.get(table_id, set()), msg)


hub = Hub()


async def broadcast_order(order: Dict[str, Any], announce: Optional[str] = None) -> None:
    await hub.to_staff({"type": "order_update", "order": order})
    await hub.to_table(order["table_id"], {"type": "order_update", "order": order, "announce": announce})
    if announce and order.get("status") == "ready":
        # the companion mentions it too, like a friend who spots the waiter coming — facts only, its own words
        what = ", ".join(f"{i['qty']} {i['name']}" for i in order.get("items", [])) or "their order"
        for conn in list(hub.companions.get(order["table_id"], set())):
            spawn(conn.proactive(f"[Café update, not the customer: their {what} is ready and the waiter is bringing it "
                                 "over now. React like a friend who just spotted it coming — a few words in their "
                                 "language, no order numbers, don't repeat these words — then carry on.]"),
                  f"announce-table-{order['table_id']}")
