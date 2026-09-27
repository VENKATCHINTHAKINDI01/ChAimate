"""What the companion sends to the model: a stable prompt prefix and a trimmed history."""
from app.agents.companion import BASE_PROMPT, TableSession


def _session():
    return TableSession(1, {}, lambda e: None, None)


def test_old_tool_results_are_shortened_current_ones_kept():
    s = _session()
    s.history = [{"role": "user", "content": "q1"}, {"role": "assistant", "content": None, "tool_calls": []},
                 {"role": "tool", "tool_call_id": "a", "name": "web_search", "content": "x" * 2000},
                 {"role": "assistant", "content": "answer"}, {"role": "user", "content": "q2"},
                 {"role": "tool", "tool_call_id": "b", "name": "web_search", "content": "y" * 2000}]
    w = s._window()
    assert len(w[2]["content"]) < 320 and len(w[5]["content"]) == 2000


def test_system_prompt_starts_with_the_cacheable_prefix():
    s = _session()
    s._menu_text = "Menu (item price): Irani Chai ₹50"
    content = s._system()["content"]
    assert content.startswith(BASE_PROMPT) and content.index("Menu (item price)") < content.index("This session")


def test_companion_knows_its_name_and_writes_it_plainly():
    # shown as "ChAimate" in the app, but spoken/written as "Chaimate" so text-to-speech says "chai-mate"
    assert "You're Chaimate" in BASE_PROMPT and 'write your name as "Chaimate"' in BASE_PROMPT


def test_nickname_replaces_the_name():
    s = TableSession(1, {"persona_name": "Chintu"}, lambda e: None, None)
    s._menu_text = "Menu: Irani Chai ₹50"          # no database needed for this check
    assert 'nicknamed you "Chintu"' in s._system()["content"]
