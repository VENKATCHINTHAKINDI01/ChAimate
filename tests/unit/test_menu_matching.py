"""The server — not the model — decides which menu item a spoken or typed name means."""
import pytest

from app.agents.companion import match_menu_item

MENU = [{"id": i, "name": n} for i, n in enumerate([
    "Cold Coffee", "Fresh Lime Soda", "Mango Lassi", "Brownie with Ice Cream", "Double Ka Meetha", "Gulab Jamun (2 pcs)",
    "Cappuccino", "Filter Coffee", "Hot Chocolate", "Irani Chai", "Masala Chai", "Chicken Biryani", "Masala Maggi",
    "Veg Pulao Bowl", "Chicken Keema Puff", "Osmania Biscuits (4 pcs)", "Paneer Tikka Sandwich", "Samosa (2 pcs)", "Vada Pav"])]


@pytest.mark.parametrize("said, expected", [
    ("osmania biscuits", "Osmania Biscuits (4 pcs)"),
    ("discuits", "Osmania Biscuits (4 pcs)"),            # speech-to-text typo
    ("biscuits", "Osmania Biscuits (4 pcs)"),
    ("biriyani", "Chicken Biryani"),
    ("irani chai", "Irani Chai"),
    ("cold cofee", "Cold Coffee"),
    ("samosas", "Samosa (2 pcs)"),
    ("filter kaapi", "Filter Coffee"),
    ("lime soda", "Fresh Lime Soda"),
])
def test_clear_names_resolve(said, expected):
    item, options = match_menu_item(said, MENU)
    assert item and item["name"] == expected and options == []


@pytest.mark.parametrize("said, choices", [
    ("chai", {"Irani Chai", "Masala Chai"}),
    ("coffee", {"Cold Coffee", "Filter Coffee"}),
])
def test_vague_names_ask_instead_of_guessing(said, choices):
    item, options = match_menu_item(said, MENU)
    assert item is None and {o["name"] for o in options} == choices


def test_unknown_dish_offers_nothing_unrelated():
    assert match_menu_item("pizza", MENU) == (None, [])
