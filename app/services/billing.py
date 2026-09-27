"""A table's running bill: food orders plus AI companion minutes."""
from typing import Any, Dict

from app.core import db
from app.services import metering


async def full_bill(table_id: int) -> Dict[str, Any]:
    """Food orders + AI companion minutes for the table's current visit."""
    bill = db.table_bill(table_id)
    ai = await metering.visit_usage(table_id)
    bill["ai"] = ai
    bill["grand_total"] = round(bill["total"] + ai["amount"], 2)
    return bill
