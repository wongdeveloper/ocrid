import unittest

from ktp_ai import (
    KtpFields,
    KtpExtractor,
    compact_ocr_context,
    detect_document_type,
    format_fields,
    needs_accurate_ai_retry,
    normalize_fields,
    parse_local_ocr,
    validate_fields,
)


class KtpAiTests(unittest.TestCase):
    def test_ai_mode_does_not_require_local_tesseract(self):
        extractor = KtpExtractor()
        extractor.openai_api_key = "test-key"
        extractor.tesseract_cmd = ""

        def fake_ai_extract(image_bytes: bytes, local_text: str):
            self.assertEqual(image_bytes, b"image-bytes")
            self.assertEqual(local_text, "")
            return (
                KtpFields(
                    documentType="KTP",
                    name="BUDI SANTOSO",
                    nik="3578100101900001",
                    birth="SURABAYA, 01-01-1990",
                    religion="ISLAM",
                    address="JL MERDEKA NO 1",
                    city="KOTA SURABAYA",
                ),
                0.94,
                [],
            )

        extractor.ai_extract = fake_ai_extract

        result = extractor.extract(b"image-bytes", "auto")

        self.assertEqual(result.engine, f"openai-vision:{extractor.openai_ocr_model}")
        self.assertEqual(result.rawText, "")
        self.assertEqual(result.fields.name, "BUDI SANTOSO")
        self.assertIn("Local Tesseract OCR is unavailable", " ".join(result.warnings))

    def test_local_mode_requires_tesseract(self):
        extractor = KtpExtractor()
        extractor.openai_api_key = ""
        extractor.tesseract_cmd = ""

        with self.assertRaisesRegex(RuntimeError, "tesseract executable"):
            extractor.extract(b"image-bytes", "local")

    def test_parse_labeled_ktp_text(self):
        fields = parse_local_ocr(
            """
            PROVINSI JAWA TIMUR
            KOTA SURABAYA
            NIK: 3578100101900001
            Nama: BUDI SANTOSO
            Tempat/Tgl Lahir: SURABAYA, 01-01-1990
            Alamat: JL MERDEKA NO 1
            RT/RW: 001/002
            Kel/Desa: TAMBAKSARI
            Kecamatan: TAMBAKSARI
            Agama: ISLAM
            """
        )

        self.assertEqual(fields.nik, "3578100101900001")
        self.assertEqual(fields.name, "BUDI SANTOSO")
        self.assertEqual(fields.city, "KOTA SURABAYA")
        self.assertEqual(fields.rtRw, "001/002")

    def test_format_eyd_export(self):
        fields = KtpFields(
            documentType="KTP",
            name="BUDI SANTOSO",
            nik="3578100101900001",
            birth="SURABAYA, 01-01-1990",
            religion="ISLAM",
            address="JL MERDEKA NO 1",
            rtRw="001/002",
            village="TAMBAKSARI",
            district="TAMBAKSARI",
            city="KOTA SURABAYA",
        )

        self.assertEqual(
            format_fields(fields),
            "\n".join(
                [
                    "Budi Santoso",
                    "3578100101900001",
                    "Surabaya, 01-01-1990",
                    "Islam",
                    "Jl. Merdeka No. 1, 001/002, Tambaksari, Tambaksari",
                    "Kota Surabaya",
                ]
            ),
        )

    def test_validation_detects_nik_birth_mismatch(self):
        fields = KtpFields(
            documentType="KTP",
            name="BUDI SANTOSO",
            nik="3578100201900001",
            birth="SURABAYA, 01-01-1990",
            address="JL MERDEKA NO 1",
        )

        warnings = validate_fields(fields)
        self.assertIn("NIK birth-date digits do not match Tempat/Tgl Lahir.", warnings)

    def test_compact_ocr_context_keeps_identity_lines(self):
        context = compact_ocr_context(
            """
            PASS 1 PSM 6
            %% @@ noisy unreadable %% %% %% %% %%
            PROVINSI JAWA TIMUR
            NIK: 3578100101900001
            Nama: BUDI SANTOSO
            Tempat/Tgl Lahir: SURABAYA, 01-01-1990
            Alamat: JL MERDEKA NO 1
            RT/RW: 001/002
            """ * 3,
            max_chars=300,
        )

        self.assertLessEqual(len(context), 300)
        self.assertIn("NIK", context)
        self.assertIn("BUDI SANTOSO", context)
        self.assertIn("001/002", context)

    def test_retry_gate_allows_nik_birth_mismatch_only(self):
        fields = KtpFields(
            documentType="KTP",
            name="BUDI SANTOSO",
            nik="3578100201900001",
            birth="SURABAYA, 01-01-1990",
            religion="ISLAM",
            address="JL MERDEKA NO 1",
            city="KOTA SURABAYA",
        )

        self.assertFalse(needs_accurate_ai_retry(fields, 0.9, []))

    def test_retry_gate_retries_missing_required_fields(self):
        fields = KtpFields(documentType="KTP", name="BUDI SANTOSO", nik="3578100101900001")

        self.assertTrue(needs_accurate_ai_retry(fields, 0.9, []))

    def test_parser_accepts_valid_nik_from_unlisted_region(self):
        fields = parse_local_ocr("NIK: 3305120310920002")
        self.assertEqual(fields.nik, "3305120310920002")
        self.assertEqual(fields.documentType, "KTP")

    def test_parser_rejects_implausible_nik_date(self):
        fields = parse_local_ocr("NIK: 9999999900990001")
        self.assertEqual(fields.nik, "")

    def test_parser_rejects_nik_that_conflicts_with_visible_birth_day(self):
        fields = parse_local_ocr(
            """
            NIK: 3578114403889001
            Tempat/Tgl Lahir: SURABAYA, 01-03-1988
            """
        )
        self.assertEqual(fields.nik, "")

    def test_parser_uses_clean_name_after_nik_from_rotated_ocr(self):
        fields = parse_local_ocr(
            """
            NIK
            3578044404880001
            LULI PRANDITA
            Tempat/Tgl Lahir
            JAKARTA, 04-04-1988
            Jenis kelamin
            PEREMPUAN
            Gol. Darah
            Alamat
            KARANGREJO SAWAH 2/24
            RT/RW
            004/003
            Kel/Desa
            WONOKROMO
            Kecamatan
            WONOKROMO
            Agama
            ISLAM
            """
        )

        self.assertEqual(fields.name, "LULI PRANDITA")
        self.assertEqual(fields.bloodType, "")
        self.assertEqual(fields.rtRw, "004/003")

    def test_known_ktp_name_confusions_are_corrected(self):
        fields = normalize_fields(
            KtpFields(
                documentType="KTP",
                name="VITHI YULIANING SIWI",
                address="JL PUNTADEWA",
            )
        )

        self.assertEqual(fields.name, "VITRI YULIANING SIWI")

    def test_known_ktp_address_confusions_are_corrected(self):
        fields = normalize_fields(
            KtpFields(
                documentType="KTP",
                name="RI ANITA PURNAMA AS",
                address="JL LEMAHWUNGKUK GG KEPHRABONAN INO 72",
            )
        )

        self.assertEqual(fields.name, "RT ANITA PURNAMA AS")
        self.assertEqual(fields.address, "JL LEMAHWUNGKUK GG KEPRABONAN I NO 72")

    def test_parser_does_not_use_unlabeled_issue_date_as_birth(self):
        fields = parse_local_ocr("PROVINSI JAWA TIMUR\nKOTA SURABAYA\n27-08-2024")
        self.assertEqual(fields.birth, "")

    def test_detect_and_parse_indonesian_driver_license(self):
        fields = parse_local_ocr(
            """
            KEPOLISIAN NEGARA REPUBLIK INDONESIA
            SURAT IZIN MENGEMUDI
            DRIVING LICENSE
            SIM A
            NO. SIM: 123456789012
            NAMA: BUDI SANTOSO
            TEMPAT/TGL LAHIR: SURABAYA, 01-01-1990
            JENIS KELAMIN: PRIA
            GOL. DARAH: O
            ALAMAT: JL MERDEKA NO 1
            PEKERJAAN: KARYAWAN SWASTA
            BERLAKU SAMPAI: 01-01-2030
            """
        )

        self.assertEqual(fields.documentType, "SIM")
        self.assertEqual(fields.licenseNumber, "123456789012")
        self.assertEqual(fields.licenseClass, "SIM A")
        self.assertEqual(fields.name, "BUDI SANTOSO")
        self.assertEqual(fields.validUntil, "01-01-2030")

    def test_detect_and_parse_numbered_driver_license(self):
        fields = parse_local_ocr(
            """
            INDONESIA
            SURAT IZIN MENGEMUDI
            C
            1554-9503-000156
            1. NUR AINI
            2. BANGKALAN, 17-03-1995
            3. O - WANITA
            4. AKIM KAYAT 7D/46
            RT 1/6 SUKORAME
            GRESIK
            5. PEG.BUMN
            6. JATIM
            21-01-2028
            """
        )

        self.assertEqual(fields.documentType, "SIM")
        self.assertEqual(fields.licenseNumber, "15549503000156")
        self.assertEqual(fields.licenseClass, "SIM C")
        self.assertEqual(fields.name, "NUR AINI")
        self.assertEqual(fields.birth, "BANGKALAN, 17-03-1995")
        self.assertEqual(fields.gender, "WANITA")
        self.assertEqual(fields.bloodType, "O")
        self.assertEqual(fields.address, "AKIM KAYAT 7D/46 RT 1/6 SUKORAME GRESIK")
        self.assertEqual(fields.job, "PEG.BUMN")
        self.assertEqual(fields.validUntil, "21-01-2028")

    def test_format_driver_license(self):
        fields = KtpFields(
            documentType="SIM",
            licenseNumber="123456789012",
            licenseClass="SIM A",
            name="BUDI SANTOSO",
            birth="SURABAYA, 01-01-1990",
            bloodType="O",
            gender="PRIA",
            address="JL MERDEKA NO 1",
            job="KARYAWAN SWASTA",
            validUntil="01-01-2030",
        )

        self.assertEqual(
            format_fields(fields),
            "\n".join(
                [
                    "Budi Santoso",
                    "123456789012",
                    "SIM A",
                    "Surabaya, 01-01-1990",
                    "O / Pria",
                    "Jl. Merdeka No. 1",
                    "Karyawan Swasta",
                    "01-01-2030",
                ]
            ),
        )

    def test_document_detection_unknown(self):
        self.assertEqual(detect_document_type("random photo without identity markers"), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
