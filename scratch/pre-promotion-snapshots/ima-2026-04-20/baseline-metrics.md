# IMA Pre-Promotion Baseline — 2026-04-21T02:08:24.579Z

## Audit
- **Domain:** idahomedicalacademy.com
- **Audit ID:** 08409ae8-28ab-4a34-b92c-2c92f73e5af7

## Counts

| Table | Rows |
|-------|------|
| audit_keywords | 1100 |
| audit_clusters | 62 |
| execution_pages | 72 |
| cluster_strategy | 0 |
| cluster_performance_snapshots | 32 |

## Classification Methods (pre-promotion)

| Method | Count |
|--------|-------|
| null | 1100 |

## Distinct Canonical Keys (66)

- `acls_certification`
- `aed_training`
- `aemt_certification`
- `aemt_course`
- `aha_instructor_course`
- `bls_certification`
- `bls_cpr_certification`
- `burn_treatment_first_aid`
- `cpr_certification`
- `cpr_first_aid_training`
- `cpr_instructor_certification`
- `cpr_training`
- `cuts_scrapes_first_aid`
- `emergency_response`
- `emergency_response_preparedness`
- `ems_courses`
- `emt_advanced_aemt`
- `emt_advanced_certification`
- `emt_advanced_intermediate_certification`
- `emt_basic_certification`
- `emt_career`
- `emt_career_info`
- `emt_career_jobs`
- `emt_certification`
- `emt_certification_requirements`
- `emt_course`
- `emt_programs_regional`
- `emt_training_online`
- `first_aid_3ps`
- `first_aid_basics`
- `first_aid_burn_treatment`
- `first_aid_burns`
- `first_aid_certification`
- `first_aid_check_call_care`
- `first_aid_cpr_instructor_certification`
- `first_aid_cuts_scrapes`
- `first_aid_cuts_wounds`
- `first_aid_general`
- `first_aid_training`
- `good_samaritan_law`
- `group_classes`
- `hybrid_cpr_classes`
- `idaho_medical_academy_brand`
- `iv_therapy_certification`
- `medical_assistant_certification`
- `medical_assistant_program`
- `medical_assistant_training`
- `medical_coding`
- `nremt_recertification`
- `nremt_test_prep`
- `null`
- `pals_certification`
- `paramedic_training`
- `pediatric_cpr_first_aid`
- `pediatric_cpr_pals`
- `pharmacy_technician`
- `pharmacy_technician_program`
- `pharmacy_technician_training`
- `phlebotomy_certification`
- `phlebotomy_technician_course`
- `phlebotomy_training`
- `phtls_certification`
- `phtls_course`
- `stop_the_bleed`
- `stop_the_bleed_training`
- `wilderness_first_aid_course`

## Committed Pages

- `how-to-become-an-emt-in-idaho` — status=in_progress, source=michael, canonical_key=emt_training, silo=EMS — EMT Courses

## Notes

- All 1,100 keywords have `classification_method = NULL` (legacy origin)
- First hybrid run will freshly evaluate all keywords (no locking — priorHybridSnapshot will be empty)
- Phase 2.3c contamination fix is present but NOT load-bearing this run
- `emt_training` canonical_key on committed page is already orphaned (no keyword has this key)
