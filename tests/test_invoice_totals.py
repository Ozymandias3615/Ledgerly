from server import _calc_invoice_totals


def test_no_tax_single_item():
    inv = {"items": [{"quantity": 2, "unit_price": 10.0}], "tax_rate": 0}
    result = _calc_invoice_totals(inv)
    assert result["subtotal"] == 20.0
    assert result["tax"] == 0.0
    assert result["total"] == 20.0


def test_tax_rate_applied_and_rounded():
    inv = {"items": [{"quantity": 3, "unit_price": 15.5}], "tax_rate": 8.5}
    result = _calc_invoice_totals(inv)
    subtotal = 3 * 15.5
    tax = subtotal * (8.5 / 100)
    assert result["subtotal"] == round(subtotal, 2)
    assert result["tax"] == round(tax, 2)
    assert result["total"] == round(subtotal + tax, 2)


def test_multiple_line_items_sum_correctly():
    items = [
        {"quantity": 1, "unit_price": 100.0},
        {"quantity": 2, "unit_price": 25.0},
        {"quantity": 5, "unit_price": 3.33},
    ]
    inv = {"items": items, "tax_rate": 10}
    result = _calc_invoice_totals(inv)
    subtotal = sum(it["quantity"] * it["unit_price"] for it in items)
    tax = subtotal * 0.10
    assert result["subtotal"] == round(subtotal, 2)
    assert result["tax"] == round(tax, 2)
    assert result["total"] == round(subtotal + tax, 2)


def test_missing_tax_rate_defaults_to_zero():
    inv = {"items": [{"quantity": 1, "unit_price": 9.99}]}
    result = _calc_invoice_totals(inv)
    assert result["tax"] == 0.0
    assert result["total"] == 9.99


def test_zero_quantity_item_contributes_nothing():
    inv = {"items": [{"quantity": 0, "unit_price": 500.0}, {"quantity": 1, "unit_price": 10.0}], "tax_rate": 0}
    result = _calc_invoice_totals(inv)
    assert result["subtotal"] == 10.0
    assert result["total"] == 10.0
