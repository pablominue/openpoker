

from app.parsers.pokerstars import parse_hand


def test_parse_hands():
    with open("tests/hands.txt") as f:
        raw = f.read().strip().split("\n\n")
    
    hands = [parse_hand(hand, hero_username="pipinoelbreve9") for hand in raw]
    for hand in hands:
        print(hand)
