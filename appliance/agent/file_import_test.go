package main

import (
	"archive/tar"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func importArchive(t *testing.T, headers ...*tar.Header) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for _, header := range headers {
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			if _, err := writer.Write(bytes.Repeat([]byte{0x42}, int(header.Size))); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestFileImportNestedFoldersBinaryAndEmptyFiles(t *testing.T) {
	root := t.TempDir()
	archive := importArchive(t,
		&tar.Header{Name: "project ü", Typeflag: tar.TypeDir},
		&tar.Header{Name: "project ü/empty", Typeflag: tar.TypeDir},
		&tar.Header{Name: "project ü/data.bin", Typeflag: tar.TypeReg, Size: 300000, Mode: 06777},
		&tar.Header{Name: "empty.txt", Typeflag: tar.TypeReg},
	)
	size, err := unpackImport(bytes.NewReader(archive), root)
	if err != nil || size != 300000 {
		t.Fatalf("size=%d error=%v", size, err)
	}
	data, err := os.ReadFile(filepath.Join(root, "project ü/data.bin"))
	if err != nil || !bytes.Equal(data, bytes.Repeat([]byte{0x42}, 300000)) {
		t.Fatal("copied content differs", err)
	}
	info, _ := os.Stat(filepath.Join(root, "project ü/data.bin"))
	if info.Mode().Perm() != 0755 || info.Mode()&os.ModeSetuid != 0 {
		t.Fatal("unsafe permissions", info.Mode())
	}
	if _, err := unpackImport(bytes.NewReader(archive), root); err == nil {
		t.Fatal("overwrote an existing copy")
	}
}

func TestFileImportRejectsUnsafeArchives(t *testing.T) {
	for _, name := range []string{"../outside", "/absolute", "a/../../outside", "a\\outside", "C:outside", "a/./b", "."} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			archive := importArchive(t, &tar.Header{Name: name, Typeflag: tar.TypeReg})
			if _, err := unpackImport(bytes.NewReader(archive), root); err == nil {
				t.Fatal("accepted unsafe path")
			}
		})
	}
	for _, kind := range []byte{tar.TypeSymlink, tar.TypeLink, tar.TypeChar, tar.TypeBlock, tar.TypeFifo} {
		archive := importArchive(t, &tar.Header{Name: "link", Typeflag: kind, Linkname: "/outside"})
		if _, err := unpackImport(bytes.NewReader(archive), t.TempDir()); err == nil {
			t.Fatalf("accepted entry type %v", kind)
		}
	}
	for _, kind := range []byte{tar.TypeReg, tar.TypeDir} {
		archive := importArchive(t, &tar.Header{Name: "duplicate", Typeflag: kind}, &tar.Header{Name: "duplicate", Typeflag: kind})
		if _, err := unpackImport(bytes.NewReader(archive), t.TempDir()); err == nil {
			t.Fatal("accepted a repeated archive entry")
		}
	}
}

func TestFileImportRejectsTruncatedDataAndExistingParentLinks(t *testing.T) {
	archive := importArchive(t, &tar.Header{Name: "file", Typeflag: tar.TypeReg, Size: 4096})
	if _, err := unpackImport(io.LimitReader(bytes.NewReader(archive), 700), t.TempDir()); err == nil {
		t.Fatal("accepted partial data")
	}
	root, outside := t.TempDir(), t.TempDir()
	if err := os.Mkdir(filepath.Join(outside, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	archive = importArchive(t, &tar.Header{Name: "escape/file", Typeflag: tar.TypeReg, Size: 1})
	if _, err := unpackImport(bytes.NewReader(archive), root); err == nil {
		t.Fatal("followed existing parent link")
	}
	archive = importArchive(t, &tar.Header{Name: "escape/nested/file", Typeflag: tar.TypeReg, Size: 1})
	if _, err := unpackImport(bytes.NewReader(archive), root); err == nil {
		t.Fatal("followed ancestor link")
	}
	entries, _ := os.ReadDir(outside)
	if len(entries) != 1 {
		t.Fatal("wrote outside copy destination")
	}
	entries, _ = os.ReadDir(filepath.Join(outside, "nested"))
	if len(entries) != 0 {
		t.Fatal("wrote through ancestor link")
	}
}
