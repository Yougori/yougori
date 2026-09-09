/* SPDX-License-Identifier: GPL-2.0-or-later
 * Private in-process Windows TPM backend for OpenDock. Only the CRB/TIS guest
 * device is exposed; there are no simulator control sockets or host-TPM calls.
 */
#include "qemu/osdep.h"
#include "qapi/error.h"
#include "qemu/error-report.h"
#include "qemu/module.h"
#include "system/tpm_backend.h"
#include "system/tpm_util.h"
#include "tpm_int.h"
#include "migration/blocker.h"
#include "tpm-api.h"

#define TYPE_TPM_OPENDOCK "tpm-opendock"
OBJECT_DECLARE_SIMPLE_TYPE(TPMOpenDock, TPM_OPENDOCK)
struct TPMOpenDock {
    TPMBackend parent;
    HMODULE library;
    OdTpmOpen open;
    OdTpmReset reset;
    OdTpmExecute execute;
    OdTpmClose close;
    char *state;
    Error *migration_blocker;
    bool opened;
};

static TPMVersion od_version(TPMBackend *tb) { return TPM_VERSION_2_0; }
static size_t od_buffer_size(TPMBackend *tb) { return OD_TPM_BUFFER; }
/* Commands finish on the backend worker before reset. Cancel is optional in
 * TPM 2.0; no racy shared cancellation flag is passed to the reference core. */
static void od_cancel(TPMBackend *tb) {}
static int od_startup(TPMBackend *tb, size_t size)
{
    TPMOpenDock *s = TPM_OPENDOCK(tb);
    return size > OD_TPM_BUFFER ? -1 : s->reset();
}
static void od_request(TPMBackend *tb, TPMBackendCmd *cmd, Error **errp)
{
    TPMOpenDock *s = TPM_OPENDOCK(tb);
    uint32_t size = cmd->out_len;
    /* TIS aliases request and response buffers. The library copies the
     * request before writing its response; never clear that input here. */
    bool selftest = tpm_util_is_selftest(cmd->in, cmd->in_len);
    if (s->execute(cmd->locty, cmd->in, cmd->in_len, cmd->out, &size) != 0) {
        tpm_util_write_fatal_error_response(cmd->out, cmd->out_len);
        error_setg(errp, "OpenDock TPM command failed; state was not reset");
    } else if (selftest && tpm_cmd_get_errcode(cmd->out) == 0) {
        cmd->selftest_done = true;
    }
}
static TpmTypeOptions *od_options(TPMBackend *tb)
{
    TPMOpenDock *s = TPM_OPENDOCK(tb);
    TpmTypeOptions *options = g_new0(TpmTypeOptions, 1);
    options->type = TPM_TYPE_OPENDOCK;
    options->u.opendock.data = g_new0(TPMOpenDockOptions, 1);
    options->u.opendock.data->state = g_strdup(s->state);
    return options;
}
static void od_finalize(Object *object)
{
    TPMOpenDock *s = TPM_OPENDOCK(object);
    if (s->opened) s->close();
    if (s->library) FreeLibrary(s->library);
    migrate_del_blocker(&s->migration_blocker);
    g_free(s->state);
}

static TPMBackend *od_create(QemuOpts *opts)
{
    TPMOpenDock *s = TPM_OPENDOCK(object_new(TYPE_TPM_OPENDOCK));
    s->state = g_strdup(qemu_opt_get(opts, "state"));
    if (!s->state || !*s->state) {
        error_report("OpenDock TPM requires an explicit per-VM state file");
        goto fail;
    }
    /* Absolute sibling path, never the current directory or PATH. The app
     * verifies this DLL and its dependencies against the runtime manifest. */
    wchar_t path[32768] = {0};
    DWORD len = GetModuleFileNameW(NULL, path, ARRAY_SIZE(path));
    wchar_t *slash = wcsrchr(path, L'\\');
    if (!len || len >= ARRAY_SIZE(path) || !slash || slash - path > 32700) goto fail;
    wcscpy(slash + 1, L"opendock-tpm.dll");
    s->library = LoadLibraryExW(path, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!s->library) {
        error_report("Cannot load the bundled OpenDock TPM library (%lu)", GetLastError());
        goto fail;
    }
    OdTpmVersion version = (OdTpmVersion)(void *)GetProcAddress(s->library, "od_tpm_version");
    s->open = (OdTpmOpen)(void *)GetProcAddress(s->library, "od_tpm_open");
    s->reset = (OdTpmReset)(void *)GetProcAddress(s->library, "od_tpm_reset");
    s->execute = (OdTpmExecute)(void *)GetProcAddress(s->library, "od_tpm_execute");
    s->close = (OdTpmClose)(void *)GetProcAddress(s->library, "od_tpm_close");
    if (!version || version() != OD_TPM_ABI || !s->open || !s->reset || !s->execute || !s->close) goto fail;
    if (s->open(s->state, qemu_opt_get_bool(opts, "create", false)) != 0) {
        error_report("Cannot open TPM state (missing, locked, corrupt, or not writable). Existing identity was preserved.");
        goto fail;
    }
    s->opened = true;
    /* Volatile TPM session state is not serialized. Do not offer misleading
     * RAM snapshots/migration; cold backups include the NV and UEFI state. */
    error_setg(&s->migration_blocker, "OpenDock TPM requires a stopped-VM backup; live memory snapshots are not supported");
    if (migrate_add_blocker(&s->migration_blocker, &error_fatal) != 0) goto fail;
    return TPM_BACKEND(s);
fail:
    object_unref(OBJECT(s));
    return NULL;
}

static const QemuOptDesc od_opts[] = {
    TPM_STANDARD_CMDLINE_OPTS,
    { .name = "state", .type = QEMU_OPT_STRING, .help = "Private persistent TPM state file" },
    { .name = "create", .type = QEMU_OPT_BOOL, .help = "Create a NEW identity; fails if the file exists" },
    { }
};
static void od_class_init(ObjectClass *klass, const void *data)
{
    TPMBackendClass *k = TPM_BACKEND_CLASS(klass);
    k->type = TPM_TYPE_OPENDOCK;
    k->opts = od_opts;
    k->desc = "OpenDock private TPM 2.0 (Microsoft reference core)";
    k->create = od_create;
    k->startup_tpm = od_startup;
    k->cancel_cmd = od_cancel;
    k->get_tpm_version = od_version;
    k->get_buffer_size = od_buffer_size;
    k->get_tpm_options = od_options;
    k->handle_request = od_request;
}
static const TypeInfo od_info = {
    .name = TYPE_TPM_OPENDOCK,
    .parent = TYPE_TPM_BACKEND,
    .instance_size = sizeof(TPMOpenDock),
    .instance_finalize = od_finalize,
    .class_init = od_class_init,
};
static void od_register(void) { type_register_static(&od_info); }
type_init(od_register)
