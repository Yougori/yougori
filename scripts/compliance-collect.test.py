"""Regression checks for source verification without network or guest execution."""
import base64
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest
import zipfile

M = runpy.run_path(str(Path(__file__).with_name("collect-compliance.py")))


class CollectionTests(unittest.TestCase):
    def test_cached_msys_records_are_all_written_to_the_final_inventory(self):
        collect = M["collect_msys"]
        globals_ = collect.__globals__
        saved = {key: globals_[key] for key in ("ROOT", "WORK", "BUNDLE", "EVIDENCE")}
        try:
            with tempfile.TemporaryDirectory(prefix="yougori-msys-cache-test-") as directory:
                root = Path(directory)
                for key in saved:
                    globals_[key] = root
                current, prior = [], []
                for name in ("first", "last", "no-longer-shipped"):
                    path = root / (name + ".tar.gz")
                    path.write_bytes(name.encode())
                    prior.append({"id": f"msys/{name}/1", "file": path.name, "status": "collected", "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
                    if name != "no-longer-shipped":
                        current.append({"package": name, "version": "1", "base": name, "license": "MIT"})
                (root / "windows-dlls.json").write_text(json.dumps(current))
                (root / "msys-sources.json").write_text(json.dumps(prior))
                expected = collect(True)
                self.assertEqual(json.loads((root / "msys-sources.json").read_text()), expected)
                self.assertEqual([r["id"] for r in expected], ["msys/first/1", "msys/last/1"])
        finally:
            globals_.update(saved)

    def test_generated_patch_recovery_requires_exact_original_checksum(self):
        original = b"From " + b"a" * 40 + b"\nindex abcdef123..123abcdef 100644\n+unchanged code\n"
        current = original.replace(b"abcdef123..123abcdef", b"abcdef1234..123abcdef0")
        expected = hashlib.sha256(original).hexdigest()
        self.assertEqual(M["recover_patch_checksum"](current, expected, "sha256"), original)
        self.assertIsNone(M["recover_patch_checksum"](current.replace(b"unchanged", b"different"), expected, "sha256"))

    def test_recipe_expansion_is_literal_and_rejects_shell_execution(self):
        variables = {"pkgver": "1.58.2", "name": "example"}
        self.assertEqual(M["expand_recipe"]("${pkgver:0:4}/$name", variables), "1.58/example")
        self.assertEqual(M["expand_recipe"]("${pkgver%.*}", variables), "1.58")
        for value in ("$(touch marker)", "`touch marker`", "${unknown}", "${pkgver:?}"):
            with self.assertRaises(ValueError):
                M["expand_recipe"](value, variables)

    def test_recipe_signature_expansion_preserves_source_pairs(self):
        result = M["recipe_sources"]('"https://example.invalid/${pkgver}.tar.gz"{,.sig} local.patch', {"pkgver": "1.2"})
        self.assertEqual(result, ["https://example.invalid/1.2.tar.gz", "https://example.invalid/1.2.tar.gz.sig", "local.patch"])

    def test_apk_inventory_preserves_exact_revision_and_file_license_expression(self):
        result = M["apk_packages"]("P:sample\nV:1.2-r3\nA:x86_64\nL:GPL-2.0-only AND MIT\no:upstream\nc:" + "a" * 40 + "\n")
        self.assertEqual(result[0]["revision"], "a" * 40)
        self.assertEqual(result[0]["license"], "GPL-2.0-only AND MIT")
        self.assertEqual(result[0]["origin"], "upstream")
        with self.assertRaises(ValueError):
            M["apk_packages"]("")

    def test_go_hash_uses_archive_names_and_content_not_zip_metadata(self):
        with tempfile.TemporaryDirectory(prefix="yougori-compliance-zip-") as directory:
            path = Path(directory) / "source.zip"
            payload = b"source code"
            name = "example.org/mod@v1.0.0/source.go"
            line = hashlib.sha256(payload).hexdigest() + "  " + name + "\n"
            expected = "h1:" + base64.b64encode(hashlib.sha256(line.encode()).digest()).decode()
            for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                with zipfile.ZipFile(path, "w", compression=compression) as archive:
                    archive.writestr(name, payload)
                self.assertEqual(M["go_zip_hash"](path), expected)
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(name, payload + b" modified")
            self.assertNotEqual(M["go_zip_hash"](path), expected)

    def test_unsafe_archive_names_and_truncated_initramfs_are_rejected(self):
        for value in ("..", "../source", "a/b", "C:source", "a\\b"):
            with self.assertRaises(ValueError):
                M["safe_name"](value)
        with self.assertRaises(ValueError):
            list(M["cpio_files"](b"invalid archive"))


if __name__ == "__main__":
    unittest.main()
