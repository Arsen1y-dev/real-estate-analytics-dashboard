# Audit: current data chain and ETL gap

## What exists

1. `yandex_realty_advanced_parser.py`  
   Output: `yandex_realty_links.txt`
2. `yandex_realty_details_parser.py`  
   Input: `yandex_realty_links.txt`  
   Output: `yandex_realty_details.csv`
3. Historical artifact: `processed_apartment_data.csv`  
   The transformation script from details to processed was not present as an explicit module.

## Gap that was found

- There was no reproducible script in repo for:
  - normalization of fields from details CSV
  - one-hot feature engineering
  - compatibility alignment to dashboard schema
  - quality report generation
  - deterministic handoff to dashboard repo

## Gap closure implemented

- Added `pipeline/etl.py` for `details -> processed`.
- Added `pipeline/categories.py` for deterministic one-hot normalization.
- Added `pipeline/schema_contract.json` as canonical schema contract.
- Added `pipeline/qa_report.py` for quality artifacts (`json` + `md`) with schema validation.
- Added `pipeline/handoff_dashboard.py` for deterministic copy to dashboard repo.
- Added `pipeline/smoke_test.py` for offline ETL/QA/handoff verification.
- Added wrappers `pipeline/run_links.py` and `pipeline/run_details.py` to run parsers from config and support resume behavior.
