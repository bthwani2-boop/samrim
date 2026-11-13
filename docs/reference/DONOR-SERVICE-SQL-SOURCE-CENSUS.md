# Donor Go/SQL source-file census (historical evidence)

ARTIFACT_CLASS: HISTORICAL_SOURCE_INVENTORY
BUSINESS_POLICY_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
DONOR_BRANCH: 41
DONOR_SHA: 426d67b47beb8c66b09acd8c7394086b53ac5aae
CANDIDATE_BRANCH: refoundation/clean-house-20261112
CANDIDATE_SHA_AT_CENSUS: ebb050024dba6950de7ad76c44c0753cef6f0942

## What was verified

Read-only enumeration of SQL blobs in the donor Git tree at its exact pinned SHA. The IDs below are Git blob object IDs (not applied migration checksums), so a future owner can trace each source without copying historical files. No production database, Docker volume, secret or service was opened or modified.

| Owner | Migration count | Version names | Finding |
| --- | ---: | --- | --- |
| Identity | 30 | 001-030 | No duplicate or missing filename number |
| DSH | 182 | 001-182 | No duplicate or missing filename number |
| WLT | 63 | 001-063 | No duplicate or missing filename number |
| **Total migrations** | **275** | Per-owner independent numbering | Filename census only |

Two additional SQL files are `services/wlt/database/fresh-baseline.sql` and `infra/local/compose/runtime-roles.sql`; all 277 SQL files are listed below. Git blob identity does not establish SQL correctness, schema equivalence, permissions, applied state, financial invariants or safe replay.

## Go source context and migration consumers

At the same donor SHA, Git tracks **836 Go source files** and four modules: `services/dsh/backend/go.mod`, `services/identity/backend/go.mod`, `services/identity/clients/go/go.mod`, `services/wlt/backend/go.mod`. No such Go implementation exists in the new foundation candidate.

DSH's donor `services/dsh/backend/internal/storage/postgres/migrate.go` embeds `migrations/*.sql` and reads embedded `migrations/<name>`; `independent_storefront_test.go` uses relative migration file reads. Any physical migration relocation must change all consuming paths and prove embed/test compatibility before removing the donor-owned layout.

## Every donor SQL file and original Git object ID

| Domain | Donor path | Git blob object ID |
| --- | --- | --- |
| Infra | `infra/local/compose/runtime-roles.sql` | `9551f84783d52dca3207aa9c7b3e52e6a51b32e4` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/001_partner_store_baseline.sql` | `6f95de662a685f0cf66ca0669785cf206d910352` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/002_store_publication.sql` | `7c4c83f9db7d05e8f7ad806518497af4f90f7a06` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/003_joining_cases_and_catalog.sql` | `b91da7dc68025cb46be5180a13a27f4df3269b32` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/004_central_product_store_assortment_cutover.sql` | `2cf91b4edcfee951ed6c60b27e585f40f14b5276` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/005_joining_case_partner_correction.sql` | `5c1885de7903b3c642bc67fe11ee7d882f535621` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/006_joining_case_correct_and_resubmit.sql` | `d602307d045a9d45f69eb5c3fc7ff986f1bf580a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/007_location_core.sql` | `06a1cb907b579da2d72b1138b52d37f951a6afaf` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/008_location_core_corrective_boundaries.sql` | `1fcb7cd57f68f37cee673689c076cf7dc2a45d0f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/009_service_city_scope.sql` | `7b3165ff7699529fc284d1c4f6e1b696d1c348cc` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/010_central_catalog_refoundation.sql` | `d218f4483dc7453398195389c858466bf636fd2b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/011_cart_checkout_order.sql` | `abefb61896c7b9414f1ce6a5a859329d76334933` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/012_catalog_semantic_correction.sql` | `f7912997c995a4303cb56782f84aeee6da2dcdab` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/013_catalog_variant_mutations.sql` | `20c175ac4cc5980d6d6b6d44ffa161509e9cfd61` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/014_catalog_proposal_import_closure.sql` | `9760b9774e10399fbedb8c2398462b3faea07502` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/015_captain_dispatch_and_identity_boundary.sql` | `bd951ed18ac6c502a12470ffebf1e8f934be3623` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/016_captain_phone_constraint_correction.sql` | `d8b0422a3b9a061dcc6aa2d988b59b75747b2fd6` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/017_captain_access_and_timeout_canonicalization.sql` | `eeeea32917704dfd3d8056a6d88c3b18cfbbe9e9` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/018_remove_unjustified_captain_terminated_state.sql` | `93a717a59cd8b0ed5b4e5b597c72c2a01d686827` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/019_captain_delivery_recovery.sql` | `12ee360330dd27dafc409a73214154e3e2df47bf` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/020_field_standing_admission_and_joining_scope.sql` | `0a6e0b0ac0accb0ff0f0ecc6b8817b6d5d2bb7e5` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/021_joining_case_store_origin.sql` | `cc36d5f9dfdbf5c036b227d95037bd430e9c74f7` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/022_order_payment_intents.sql` | `8e8622f24fed62eb76cb4dea89c7a05a90bfaee9` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/023_catalog_media_management.sql` | `906601b9ac7227248b852896836bb5c8c09c1e30` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/024_catalog_media_assets.sql` | `708d0a888c59cc16c8578005309c300c1e864dbe` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/025_order_client_cancellation.sql` | `0b7d748e254a0673d86d2704ff18f733cf4e99fe` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/026_captain_live_location.sql` | `006394af6b96e3f283e3dc964fa8112fdb956c1e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/027_notification_read_state.sql` | `550d9b11bccfdeeb6404334f4132da2b34c7cf16` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/028_client_favorite_stores.sql` | `07840b8a7ba2d23f4821d0ae1ee80df7e95f901f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/029_order_delivery_proof.sql` | `92dbb474730c8138223cf0bd4871f676c795259e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/030_order_ratings.sql` | `b74633256fa090419e643197e7bc825799eaf690` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/031_field_joining_writer_cutover.sql` | `cd19d9f1f65e5960533f4f707f71fdb61d77133a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/032_catalog_quantity_inventory.sql` | `e2dfe4e39dfc2d7f1bef9cf2356072cf656bd3c7` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/033_partner_financial_terms_binding.sql` | `11d5fed5bb205ada048fd1c81254c81c5a9b0608` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/034_field_commission_publication_outbox.sql` | `69d287d6c6294366a9f2913513f5a68c8173db7c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/035_order_fulfillment_mode.sql` | `0857acb99106c44115effc712bcec9629c1c0b15` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/036_commerce_financial_handoff_outbox.sql` | `53e84b5296c4e2a720331fb194d773372bdb6c17` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/037_financial_handoff_actor_provenance.sql` | `71fd852d8270aaaafd30ba4f0f956f56aa3e22a3` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/038_order_conversation.sql` | `ffcb7f366c12c4c72b94a9975201595e5d9963e2` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/039_promotions_discovery_content.sql` | `a27aa211ec2c1c5c96ad71da616623ff68d6f028` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/040_multi_store_checkout.sql` | `f2b405ab6c9a7a8f573e4f21cff203e426a485d6` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/041_store_profile_media.sql` | `ab516d10173c71356f00a6fd4135dfc4ad83acda` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/042_field_notifications.sql` | `cf07aaad4317b39fd6b3bf2c124093c84dbafb74` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/043_discovery_content_analytics.sql` | `888ff1c11d3fba3d11243be76fa4aaecf5d48507` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/044_store_pickup_financial_handoff.sql` | `e0e207fa646f537003de9ecc35846072cc059a8e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/045_customer_pickup_fulfillment.sql` | `814a08d6db3a5f9dfdb305c1f6c1522cc7973726` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/046_store_fulfillment_modes_management.sql` | `8cbc5f07e545215b473033e42f02f780e3358113` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/047_store_captain_membership.sql` | `8948a1a46576a08fb7f8d7e94b0137494936cea7` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/048_customer_pickup_cash_at_store_payment.sql` | `fad07bba9f69a60281436c5304a0a0330777302b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/049_customer_pickup_order_audit_events.sql` | `7066cd8cdf5c623ee6f80318c145967b02119daf` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/050_delivery_proof_encryption.sql` | `fc3c034799b32134376fc368286ddd190e54a441` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/051_store_captain_dispatch_offers.sql` | `bf6d67725e141f5b0eafd17344af029f8ba01128` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/052_partner_captain_fulfillment_mode.sql` | `4c272d6dc64e73f3db451ec344be6d11e319dd43` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/053_operator_store_fulfillment_modes.sql` | `c15328ccc7f12fdd6f1b1fcceab0056ae753afa1` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/054_partner_captain_store_cash_handoff.sql` | `e3268aaa6a2909589ea89b50e937a8c0cfd5eda3` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/055_catalog_registry_change_audit.sql` | `7f7923efbd54d280fe4d91fa82710f3b26ccd4e0` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/056_catalog_attribute_rule_change_control.sql` | `88cf3b2caf7afefb677f1a653c6cd8f7229db63a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/057_catalog_proposal_attribute_values.sql` | `16c8d364ae7977909d1a4d901a8b8350213aad9d` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/058_captain_operator_availability_reason.sql` | `54060fa7ca21871f7c9891f1b8bd52fb52c1f18e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/059_commerce_vertical_catalog_model.sql` | `bf791938221bfe49fdaa7c0fda943b678622067b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/060_catalog_product_description.sql` | `97ab9b8c1ccacf2078cedc61a59e5fe1524bd98f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/061_operator_store_registry.sql` | `b825269e617fda9f68b2aa1a47341c0bdea2dcc4` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/062_client_favorite_store_offers.sql` | `5510195bf4d016e2378f77876914f1a49d6439c3` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/063_partner_financial_terms_policy_provenance.sql` | `4a46c4c41a230e8b96af7724eba0c1bd27de7e1d` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/064_partner_captain_cash_at_store_payment.sql` | `12141894a053c1e4ae17ea1ce5ee86484d28816c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/065_marketing_operational_registries.sql` | `abca1cd0addfafe3e084ba117da57cae7eff20bc` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/066_catalog_category_media.sql` | `c5feab49f3454989700d96e20997dedacbf5e8d8` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/067_store_profile_media_cleanup.sql` | `e441663c40be5823127b6c54bff584c037b83947` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/068_field_operator_partner_admission.sql` | `1f8fb225251742369531b1564637c2750d39a46a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/069_catalog_store_offer_paging.sql` | `094ceb97d6d54637e71a359230c31a4a78a1b306` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/070_public_store_discovery_pagination.sql` | `cf44d86198a4f5fbf7432f44b10cbd7f4290e781` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/071_field_captain_profiles_and_review.sql` | `f08b2304de8420dba62c90bd2fba5bca4c51b8b6` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/072_store_profile_media_provenance.sql` | `2ac49890c4ac17a66a21bd5c04654437ccabb2bc` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/073_catalog_media_asset_references.sql` | `0d36994abf25521ab5c4fcb038165ec34b2c5dd5` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/074_catalog_media_provenance.sql` | `4f10fb38f9a85ee1f311cef8e1662380c834110c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/075_discovery_content_media_assets.sql` | `1437c900ac568b32e745923d77880e397c9e4cab` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/076_payment_cash_amount_snapshot.sql` | `3cf6c79cc7cb149c655eb31a91f946e70093e49f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/077_balance_only_financial_handoffs.sql` | `d20a9e2d21e5961601b4d736f98beecfce2ea442` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/078_catalog_offer_visibility_views.sql` | `dfafdf2586927d1bebcc1b52b7787578531ad08a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/079_field_admission_service_city.sql` | `2fb41f0f096dec85fbedde4f1e156477e0d89cf5` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/080_field_acquisition_entitlement_handoff.sql` | `d740f93f65e1a994862d3276569ef7518ee16e93` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/081_commercial_store_types.sql` | `27f4f668b58bbaef3438aa096d1cde1ccf082ef0` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/082_field_acquisition_commercial_type.sql` | `2c1fff07044a053b9da7aa6e8b1e737f8d661b91` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/083_store_commercial_type_assignment.sql` | `43f37446274e91dbdb3f72f55511d121a7dac870` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/084_store_type_commission_owns_rate.sql` | `4a3b5caf07baa81ab34026df5f6d4cf04f852334` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/085_store_operational_availability.sql` | `4bf8e9e06465d85ced0188e767400454228f3158` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/086_store_scoped_access_delegation.sql` | `52b8c764621f5ede029189dbf8c44980217e74b3` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/087_order_recipient_and_adjustments.sql` | `b30694d079de9b9639bc082fd4577f7e5fc1d3b1` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/088_store_access_invitation_reuse.sql` | `1dc8404277483180091c2012014d1241ab1e8069` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/089_store_access_permission_updates.sql` | `f247855be5767f314a95faeade92e5484f0d5cb3` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/090_order_store_orderability_snapshot.sql` | `a71685b4bbbb359dc1f3a0394dd3b5a70176dc06` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/091_order_adjustment_financial_handoff.sql` | `057cb5256af7270996efcbbc4302b44f25cc6bc5` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/092_joining_case_store_intake_details.sql` | `f010870abeb20e112464175eab72ca664693c3f8` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/093_catalog_mixed_scope_and_store_skus.sql` | `6999e77f60e24a38e6a4806849ebe18e759d3cad` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/094_store_go_live_notifications.sql` | `8376fe3ad6e1c82b6c48b839152ddde6417c2072` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/095_wallet_provider_intent.sql` | `056a8bd64f7583cd5bd0db7861a406ee74caf78b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/096_catalog_product_proposal_field_ownership.sql` | `7eeaeb61c122d006faf0220a45af8c98eebaa30b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/097_store_catalog_import_scope.sql` | `02093c64beb61bebe7cb338e9a61619a43e1d336` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/098_promotion_funding_vocabulary_and_order_snapshot.sql` | `3bce413cfc0046381931c9dc25a3263264d230d3` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/099_store_access_permission_expansion.sql` | `9bb4d345e79815694e647e57348e33fd557ecc99` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/100_promotion_targeting_and_campaigns.sql` | `5d5e53f30a5ea5308414251850928bb8de68d1fe` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/101_store_access_fulfillment_requires_orders.sql` | `8a01b2640dd17baadebba40651a9c5f01fb486a5` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/102_joining_case_field_drafts.sql` | `43b0e7dd3ed8e09d40f2b8a99699c6f0b170214d` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/103_field_city_assignments.sql` | `b03f8d2cc9ccd0bec627bda0d45fc30bbcdeb934` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/104_field_city_assignment_cutover.sql` | `a766eb99954f059b99609e28ba754e27ec4c84ea` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/105_field_draft_fulfillment_readiness.sql` | `738ee8fde74c15d6c2775b3e3791388e3b8f8d9a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/106_wallet_providers.sql` | `77b03af42cc88f56b7e838cc6e0b4a70536830d9` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/107_catalog_attribute_lifecycle.sql` | `80f6ff2f90c9ca64cad73cdaab1a0efe5a55b525` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/108_backfill_joining_hours_into_orderability.sql` | `78bb03946eeb9d01c85f3925445497f5457cbc0c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/109_partner_passport_proof_type.sql` | `bcedab73bcd8af4249f4e8b054c20143c8e87361` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/110_joining_case_review_photos.sql` | `edbd8433e6cdaa65acf897041861cdbbf06b3910` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/111_catalog_product_recycle_bin.sql` | `73067b43226303d22e0436dff14cd465220206fa` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/112_catalog_category_recycle_bin.sql` | `333ab34cf5a96f7f1de6f385605159dbba5e0bdd` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/113_store_recycle_bin.sql` | `4d1ae0dfabaa84c724a21ec3cc2d5a55c5eb6883` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/114_hr_employee_directory.sql` | `c78adf5a69a4da338bd074cfcf8d85661d9c1f0c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/115_hr_operator_access_requests.sql` | `63796df8d9c361aa82f8644ac5aa4dc38db08594` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/116_hr_employee_profile_updates.sql` | `c941802286b4b9048d96cfb733f6df108d761e48` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/117_hr_access_request_rejection.sql` | `4107e47b661006c600f3d27f3b5a4e36a86f99fd` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/118_hr_operator_actor_link.sql` | `6eff678fc4f40dd720476308ded65e12156eeabc` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/119_hr_employee_employment_status.sql` | `87486fbf7feb93cdcb9d3285329d80cad81ad6a8` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/120_hr_manual_attendance.sql` | `428a29de4a21044d73156b4eaf72ec6004f7615c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/121_operator_partner_registry_search.sql` | `8a8a086cc101a6bd1f86db5053f5994cfbd9fae2` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/122_store_access_admission_pages.sql` | `a3e9ae49da357a3827b2b41e24ffcd2b96412077` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/123_customer_catalog_popularity_indexes.sql` | `096196db9d0b9aefa366d89740e30d0ed0f76806` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/124_promotion_discount_budget.sql` | `e624e96d1b681274e6eacfea419fa9fda01560ef` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/125_store_cover_media.sql` | `5827cc2b3dc3cf0106b4ee1f9650f818f54358ee` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/126_store_internal_photos.sql` | `e046640f77b898a2e8e871275240f04d3bc56f8f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/127_captain_presence_latest.sql` | `daf3e873e9c44c564b21a3696c9b08f030c56e66` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/128_captain_parallel_dispatch.sql` | `1d62883a1205d33108aae1e2d3d1df81df41b8f1` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/129_store_owned_media.sql` | `87472fdead54542314acbc24644c6134ac3e427d` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/130_captain_delivery_confirmation.sql` | `e09e7a54a1e931fc697ee3af7083924741494971` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/131_catalog_registry_unique_names.sql` | `663a992d369519c7ca076d167580078a8c277599` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/132_catalog_shopping_shortcuts.sql` | `e15842a3cf213b827ab11575a99a5385a55903c0` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/133_commerce_vertical_media.sql` | `4c1a564c2735fac55692d4df91c4c1b7b18d99c1` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/134_discovery_conversion_unique_order.sql` | `e8bfea0f62bda1a61d7950b9165b660df622e35b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/135_operator_cancellation_review.sql` | `4922e9d8c24ee70e808045f141a586298ccc0ef8` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/136_order_cancellation_support.sql` | `42d6e2a6cc32f79c5ea7fc8be5fa4555032bcdac` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/137_initial_cancellation_policy_modes.sql` | `4f51acae6571e0fad492f7e652d060cbd2feb39a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/138_store_team_display_name.sql` | `beb3db13ed263446fd96efbf55fa2d217cc91e78` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/139_store_captain_targeted_invites.sql` | `4ade6c5e1cdafda84bfb85cd18e2afcda356ca04` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/140_store_scoped_catalog_categories.sql` | `11a163839ba22c89d78d27ae65934c26fb0bc68c` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/141_order_conversation_recipients.sql` | `d3d50e82780abe06f8c5db2e313caf689776e384` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/142_order_conversation_private_media.sql` | `f5b7135ce3dc1acc05d5407d0702d6fcf595f327` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/143_wallet_provider_logos.sql` | `3ada783277d7f6265e55c278454f0894d715854a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/144_order_customer_notes.sql` | `0225029aec1dd416e82e6503850c6ec6cdc4b215` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/145_marketing_banner_presentation.sql` | `e9f9c705cfca05eb02444ed63e2a0535da9ed266` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/146_captain_goods_custody_limit.sql` | `88227ae4618f6f62d1a804ea84dcddf718711149` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/147_customer_order_contact_verification.sql` | `903d7cb8d8253031d04e8664f69000497d3b77b7` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/148_captain_mission_latest.sql` | `a04ccd5172cc6444f2b04b0cfa9d6a714e19860e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/149_operator_order_cases.sql` | `79876f4c9fdeda5b009081109b58777d77309d8f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/150_operator_case_resolution_proof.sql` | `a64ebe36ff65ef21448888584dfb5868b13ee4e4` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/151_operator_captain_location_loss.sql` | `26607053be3137ab5d8f5ca65e2c97fc1d534afb` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/152_customer_contact_claim.sql` | `97db776727952f14ff943bbec490e224a1b8308b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/153_customer_contact_real_pending.sql` | `e50da2ee9b80db708f98c3ffbf8244715de12ea8` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/154_marketing_campaign_registry.sql` | `3f02d843a429bd6ca9de497ea6f91ac4eebd8f71` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/155_customer_marketing_consent.sql` | `097bc79e496012432fdabe033e3650d5d954aa27` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/156_marketing_campaign_state_audit.sql` | `f574f08a7d66ce43486a3286f8892c47eaade351` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/157_operator_stage_sla_policies.sql` | `ac7ba7e3621f9794b8869e0ec85098d8171ab78f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/158_operator_stage_sla_approvals.sql` | `a91d4a7e04fa64c0c3f7f1cc6704367620df1997` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/159_captain_delivery_arrivals.sql` | `ede4203056c7e1d7ea37178e7677424906c304a1` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/160_order_push_outbox.sql` | `af9bf79e417be14d8a320d234d098ce9ce6e744e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/161_discovery_content_short_form_video.sql` | `6845dc8e3a9cff805381eb1e8d77121f62300921` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/162_client_content_shares.sql` | `848610200eb4fed1496e43be1c7c67035677c83a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/163_discovery_content_partner_source.sql` | `f5df96a4a909b06d2516f11d8af1d0af38cf68bf` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/164_joining_case_acquisition_attribution.sql` | `f2cceb128f7ca4c68ec590b81cfeb99f75886d59` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/165_self_service_joining_origin.sql` | `a0d82f59e88b913d9e84279b87a23ad7f3507027` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/166_marketing_studio_draft.sql` | `647fc48001ef8db347bca20756653b42503fad2e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/167_marketing_studio_publication.sql` | `9a5f9896331b186c7dcc79e6700c5c2744ce4a6b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/168_store_public_contact.sql` | `6540f0269218a5f84e0adc948b8883b23fdbab28` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/169_marketing_studio_layout.sql` | `8a956fc8fe2e2a0b162f52ded9b715dcf51bafbb` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/170_customer_catalog_name_infix_search.sql` | `c5aa7928400d3ae96c06f28c52c4a33cbaf3809e` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/171_partner_store_banners.sql` | `b0b0ffd21835beba739895a3fa8c01493fd97237` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/172_store_relation_foundation.sql` | `313feaf0d8d2e6345c972a893b1472c241aed4e7` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/173_store_joining_policies.sql` | `e16c7011fa88406d54088ef357e7b3d80b03d9ce` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/174_independent_storefront_and_direct_orders.sql` | `ef675978f9eef52463651b99a136a545bfceec75` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/175_first_store_create_idempotency.sql` | `61e30514a0a8480f7074663d1cb088787ef5cb21` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/176_retire_parallel_independent_orders.sql` | `3d7b46c0961fcced736e4c6cab0fd925320519a4` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/177_unify_store_create_idempotency.sql` | `968175c7c6919ede849265c14564f9a925878a6b` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/178_multi_store_checkout_count_and_index.sql` | `80a9eb68519ce3e525f1cda56ad0da30be589d42` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/179_captain_mission_actor_integrity.sql` | `297143cb1d6fcca3130d1b9892824433713e0676` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/180_multi_store_checkout_child_lineage.sql` | `9db6b5c197f48773f3fc53301362cd710ad4d65f` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/181_commerce_order_cart_actor_integrity.sql` | `f1da692f0ac1d259e0dfe2bf814082f86314c93a` |
| DSH | `services/dsh/backend/internal/storage/postgres/migrations/182_retire_duplicate_store_offer_index.sql` | `985d38e5d67dea3abb251f67c53f04fba1c8a44d` |
| Identity | `services/identity/database/migrations/001_identity_authentication.sql` | `7704852f2ccfec1ecd0a6e712135b0a45525be6e` |
| Identity | `services/identity/database/migrations/002_identity_challenge_delivery.sql` | `79d2b88fc95999083830a257bd8ca85bd985d531` |
| Identity | `services/identity/database/migrations/003_managed_activation_codes.sql` | `afa298f62d5e89ecb08de68ca9e349997019a943` |
| Identity | `services/identity/database/migrations/004_control_panel_roles.sql` | `424eac71659ca8f03c3edb8b9f56bab360c7bf1d` |
| Identity | `services/identity/database/migrations/005_platform_owner_activation.sql` | `82523be29009576e1b7c45dfa4b1e6f0684d8441` |
| Identity | `services/identity/database/migrations/006_managed_role_passwords.sql` | `6757e04b16095111742b48860b0b35de89e6783d` |
| Identity | `services/identity/database/migrations/007_four_digit_challenges.sql` | `1c8075ef13b7e2674ffab9c9a82452e0d60c9679` |
| Identity | `services/identity/database/migrations/008_identity_session_lifetimes.sql` | `3fbef279798577cad13fdd8e4267845414791683` |
| Identity | `services/identity/database/migrations/009_control_session_lifetimes.sql` | `d34d740f6bc2abb20fc2a49526a87ccf42eb50f9` |
| Identity | `services/identity/database/migrations/010_identity_proof_fences.sql` | `a31213c5c599adf58c059022447d9dcfa85a110b` |
| Identity | `services/identity/database/migrations/011_identity_recovery_purpose.sql` | `2788bbe100948146457baae4a9466cd4334d56ef` |
| Identity | `services/identity/database/migrations/012_identity_migration_checksums.sql` | `fd44f8bcebfd9b719d63386f25238ebbb5563486` |
| Identity | `services/identity/database/migrations/013_identity_password_admission.sql` | `6b4bf16928afbbcb8e411547f37536769f882b6e` |
| Identity | `services/identity/database/migrations/014_canonical_closure_remediations.sql` | `daa7d18d3485e7f120769cb1b8dff2beafc3af7b` |
| Identity | `services/identity/database/migrations/015_six_digit_challenge_cutover.sql` | `d5b3878b936181ed536f9893d816c82bee993cc6` |
| Identity | `services/identity/database/migrations/016_operator_only_control_panel.sql` | `e1314f5fe8e8a775d0e607a2c6bdc229b3ca2e9b` |
| Identity | `services/identity/database/migrations/017_operator_passkeys_and_instance_binding.sql` | `cec4d1633acbaf140469ded07600f7e73526688c` |
| Identity | `services/identity/database/migrations/018_mobile_session_lifetime_cutover.sql` | `e3a4a2f1c971fd114b04d4ec5756d1a199951b05` |
| Identity | `services/identity/database/migrations/019_durable_refresh_reconciliation.sql` | `46cc0a9417c18caaa72b62bdb302b96a71461e25` |
| Identity | `services/identity/database/migrations/020_operator_finance_permission.sql` | `cdbea23d4682e988970ad53539f89c52b2fcc59c` |
| Identity | `services/identity/database/migrations/021_operator_platform_policies_permission.sql` | `b7dd96b5dacdc17dfe6f0196baebac1f437331cd` |
| Identity | `services/identity/database/migrations/022_operator_workspace_permissions.sql` | `ff21b236cbab3733323288274c984bd7c68e1522` |
| Identity | `services/identity/database/migrations/023_verified_actor_legal_names.sql` | `421f9547510b84c5a1e4ab65241e323a5c193527` |
| Identity | `services/identity/database/migrations/024_operator_profiles_and_review.sql` | `23b31139f44f844684ab5bc41ab83a0210cccf75` |
| Identity | `services/identity/database/migrations/025_managed_role_password_recovery.sql` | `b3cc4d0a6e71fd89d39828222c6e86e0c5168b6a` |
| Identity | `services/identity/database/migrations/026_field_app_foreground_timestamp.sql` | `bb3215686645b27f859e3c4fcc5ed134b3e416e1` |
| Identity | `services/identity/database/migrations/027_operator_role_details.sql` | `c3344f4e2500c8d43a3b6a8a3e7dbc52ae390452` |
| Identity | `services/identity/database/migrations/028_operator_recovery_reservation.sql` | `8c6525978fc54de9b929fc216b1229d5db259b20` |
| Identity | `services/identity/database/migrations/029_operator_hr_permission.sql` | `ffbcaf2b64cf59dd7cb2dcb9e1506be42c3512ff` |
| Identity | `services/identity/database/migrations/030_retire_redundant_legal_name_version_index.sql` | `8a94a2950d774247ed56779083273c6e75665319` |
| WLT | `services/wlt/database/fresh-baseline.sql` | `d7541127cbf9d4c9c5bb58bad654ca62c26d4a6f` |
| WLT | `services/wlt/database/migrations/001_payment_intents.sql` | `a2fff8c72a240198d23c215bd184085f516dccde` |
| WLT | `services/wlt/database/migrations/002_cash_remittances.sql` | `668f9ce4788e0884fde1199cfa5883c86781a7ff` |
| WLT | `services/wlt/database/migrations/003_partner_financial_profiles.sql` | `256d3654fea72a649ae9a52a3331ea5f2a18966d` |
| WLT | `services/wlt/database/migrations/004_payment_allocations.sql` | `05a4b41d82f648cb5d93a77105b63f19776d00ee` |
| WLT | `services/wlt/database/migrations/005_delivery_fee_policies.sql` | `6601b5954df6368f890fe31e0e9b557e718584e4` |
| WLT | `services/wlt/database/migrations/006_partner_order_earnings_ledger.sql` | `337b892a703dc5160ba46cb0d5c0936a673680fd` |
| WLT | `services/wlt/database/migrations/007_official_wallet_destinations_and_payout_intents.sql` | `e5bcb0ce03a86f58ace57f5aaabf995e1935149d` |
| WLT | `services/wlt/database/migrations/008_field_commission_policies_and_earnings.sql` | `8ba7e514d02b8b40da9944ed01616b65c5153cde` |
| WLT | `services/wlt/database/migrations/009_manual_settlement_governance.sql` | `1d51552eff94aec74a42055d0c6b5f9222ef80a5` |
| WLT | `services/wlt/database/migrations/010_captain_wallet_cod_reservations.sql` | `9b9120ca6dcaad06e9d1222ca95a9c4427878f56` |
| WLT | `services/wlt/database/migrations/011_captain_cod_collateral_settlement.sql` | `2f7941cef5c2b095cf042443317101289a3aff7c` |
| WLT | `services/wlt/database/migrations/012_customer_payment_allocation_refoundation.sql` | `f9d381cc72e6cc5647e5981d6d70d0df4ef0e828` |
| WLT | `services/wlt/database/migrations/013_captain_cod_reassignment_reservations.sql` | `5cce40941a526142155744657e160cd3c0c68476` |
| WLT | `services/wlt/database/migrations/014_partner_store_pickup_commission_receivables.sql` | `57a1881d051a4df1ca72715f621d9257a74c6559` |
| WLT | `services/wlt/database/migrations/015_partner_store_cash_commission_generalization.sql` | `63eca7523d538c520c2da428cad81b969779f714` |
| WLT | `services/wlt/database/migrations/016_partner_store_mode_commission_snapshots.sql` | `c5335242e1d6d6e9f9949630d6af827bcc4ff4bf` |
| WLT | `services/wlt/database/migrations/017_policy_change_control.sql` | `88f1b4b562665df2cf9a85db628dc2e946e50a2c` |
| WLT | `services/wlt/database/migrations/018_partner_financial_terms_policies.sql` | `1ccf28eebd26b5bc1aae5d004e37dede728422f2` |
| WLT | `services/wlt/database/migrations/019_settlement_statement_reconciliation.sql` | `33f13706267fb16210e60a6dc2a5fdd1f638d98b` |
| WLT | `services/wlt/database/migrations/020_settlement_batch_execution_artifacts.sql` | `d2c1279cefa86502a52213fa5e99cefa6ade6ee9` |
| WLT | `services/wlt/database/migrations/021_finance_evidence_download_audit.sql` | `e5cdaddb087b1ae59170c01600c8b0ff7b448357` |
| WLT | `services/wlt/database/migrations/022_cash_in_funding_intents.sql` | `1c9d451ebdf71a44a5d459dafd4ca5d15b222f44` |
| WLT | `services/wlt/database/migrations/023_destination_identity_name_provenance.sql` | `bece3e68d9a877b001bb6c4ecf4e3e65c0a9b75f` |
| WLT | `services/wlt/database/migrations/024_customer_manual_withdrawal_intakes.sql` | `a9739599e71a5a2660f030df85b68bb236137562` |
| WLT | `services/wlt/database/migrations/025_customer_withdrawal_registry_search.sql` | `51c6da14b0181bc0f46e27634c329abfb220dacc` |
| WLT | `services/wlt/database/migrations/026_cash_custody_operational_registry.sql` | `9238e334ef99d219dd84f562bd643235627efeee` |
| WLT | `services/wlt/database/migrations/027_partner_commission_policy_snapshot_length.sql` | `0315a1d935aff371d8c5385da4c39e3c00aacc9b` |
| WLT | `services/wlt/database/migrations/028_customer_balance_order_settlement.sql` | `ae75ec2e5c5f7d8441d9700bf706760960edf6b7` |
| WLT | `services/wlt/database/migrations/029_settlement_separation_of_duties.sql` | `84247659addc1e62be5a5b64017f1f7ae3c653e7` |
| WLT | `services/wlt/database/migrations/030_field_reward_category_policy_scope.sql` | `d4e61c4cdd9584bbd45f864dd5eca1a3d5cd3734` |
| WLT | `services/wlt/database/migrations/031_field_acquisition_entitlement.sql` | `4858485494e172e3ac2f8268010dd71481b75a4c` |
| WLT | `services/wlt/database/migrations/032_commercial_store_type_policies.sql` | `a979e84f6025e32bf6eff028cebf481e4b76c92f` |
| WLT | `services/wlt/database/migrations/033_commercial_store_type_commission_policies.sql` | `8367cd55863aea698b9a55d6390adf1ab9a9ab5f` |
| WLT | `services/wlt/database/migrations/034_store_type_commission_owns_rate.sql` | `da4b155797e1480d1ae09416a1dd7904759ae78b` |
| WLT | `services/wlt/database/migrations/035_captain_cod_remittance_reconciliation.sql` | `09289c31148c9608275ead6da8baa51e9bd55348` |
| WLT | `services/wlt/database/migrations/036_partner_commission_remittance_receipts.sql` | `3b8bfa710e221e76bfe025c2558c2ea5bde5f536` |
| WLT | `services/wlt/database/migrations/037_finance_transfer_receipt_claims.sql` | `e5c0b29d38b2f4c2c597fead8153da6f2843e807` |
| WLT | `services/wlt/database/migrations/038_order_adjustment_reconciliation_cases.sql` | `1221f49aaabe95f4a9565c6f69631f46fb75fbb8` |
| WLT | `services/wlt/database/migrations/039_store_agreements_and_identity_reverification.sql` | `5760be062e3a57c49c84873d49138f382fdadce1` |
| WLT | `services/wlt/database/migrations/040_store_agreement_finance_decision_facts.sql` | `17969c7bf6332d1c976b81dbb79de30b44e5c16d` |
| WLT | `services/wlt/database/migrations/041_official_wallet_identity_stale_transition.sql` | `15074af307eb4920d6611d8f19e333b56e979cfe` |
| WLT | `services/wlt/database/migrations/042_store_payout_recipient_assignments.sql` | `efd5c26d76d64c67e006326785b6b828c8f09325` |
| WLT | `services/wlt/database/migrations/043_partner_earnings_store_attribution.sql` | `bc63748a41a46f937db4c66a9c4a172634c7b02a` |
| WLT | `services/wlt/database/migrations/044_partner_payout_partitioning.sql` | `bf716fa460dfb3886392f414b7a2983f12d48858` |
| WLT | `services/wlt/database/migrations/045_order_promotion_funding.sql` | `32329fc4dd64cf5d3585e89fd352c86c3a186d2c` |
| WLT | `services/wlt/database/migrations/046_partner_payout_store_scope.sql` | `2b80aece1578aa36a8df26cd2a58650350ceea81` |
| WLT | `services/wlt/database/migrations/047_promotion_expense_ledger_account.sql` | `8a31cea20642a8378c06cfc379e79aeb6cc4a3f0` |
| WLT | `services/wlt/database/migrations/048_customer_wallet_compensation.sql` | `057803cede44ab563461a5e44ac74246ab38418d` |
| WLT | `services/wlt/database/migrations/049_captain_minimum_balance_policy.sql` | `713eb5aa5119ae6ca48551540373ea01223bff69` |
| WLT | `services/wlt/database/migrations/050_delivery_distance_bands.sql` | `d011a11bad0dc302765fb85ecbb8581275293528` |
| WLT | `services/wlt/database/migrations/051_beneficiary_settlement_intake.sql` | `b9cf4ac9902cb36b2c42d7d837ced7db4fd4f3a6` |
| WLT | `services/wlt/database/migrations/052_captain_cod_wallet_debit.sql` | `63a74b65091d94db9e4bd22bc8d291da35b27f2c` |
| WLT | `services/wlt/database/migrations/053_delivery_margin_and_store_markup.sql` | `df537d2840079d4265fcb6c22e49faae9729d14d` |
| WLT | `services/wlt/database/migrations/054_partner_delivery_pricing_modes.sql` | `91020d81c43f14ad6806fe3f57b6f75401342336` |
| WLT | `services/wlt/database/migrations/055_cash_in_provider_fee_platform_expense.sql` | `46e229fb3cfb79edbe71ebad33be4e121e0ad4f5` |
| WLT | `services/wlt/database/migrations/056_customer_compensation_closes_reviewed_case.sql` | `ae59ef221fa18d452d5bb6d646985b316a2ba20b` |
| WLT | `services/wlt/database/migrations/057_partner_commission_credit_guard.sql` | `b09beeb7afe82eaeb050b5a413fb2688c2fcb1be` |
| WLT | `services/wlt/database/migrations/058_self_service_partner_profile_origin.sql` | `0094da27d1dc1b514857da193f6937d45215417e` |
| WLT | `services/wlt/database/migrations/059_store_agreement_commercial_models.sql` | `4be9592c271b8cf5a192068bf0bb1f357082e2fe` |
| WLT | `services/wlt/database/migrations/060_retire_hybrid_store_agreements.sql` | `b6eba295a8f14cb550700c9678431bbf7b60c860` |
| WLT | `services/wlt/database/migrations/061_legacy_cod_recovery_reviews.sql` | `a7b9df211602b6c00c04e97069f9d374af1668ae` |
| WLT | `services/wlt/database/migrations/062_store_relation_commercial_model_defaults.sql` | `ab44e2f2eb58fc75707eac0342cde6e4a873df77` |
| WLT | `services/wlt/database/migrations/063_store_relation_model_default_event_integrity.sql` | `1c978347175ba8e8e548077506e244e2229316c2` |

## Blocking gates before importing or running migrations

- Reconcile contracts, Go imports, embedded paths, current database and source-owner policy at the final admitted revision; this census is not an approval to implement SQL.
- Inspect authorized target PostgreSQL catalog and applied migration checksums without copying protected data.
- Prove fresh install vs protected upgrade parity and isolated backup/restore; review PK/FK/unique/check/index/RLS/grants/functions/triggers and WLT ledger/COD/Wallet/Mixed invariants.
- Obtain independent finance, security and migration review before any destructive or financial cutover. No migration or go.mod was copied into the current worktree.

STATUS: DONOR_FILE_CENSUS_PASS; SERVICE_SEMANTIC_RECONCILIATION_PARTIAL; SQL_RUNTIME_NOT_RUN; FIN_SEC_MIG_REVIEW_BLOCKED.
