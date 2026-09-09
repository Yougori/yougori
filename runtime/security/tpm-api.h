/* SPDX-License-Identifier: BSD-2-Clause */
#ifndef OPENDOCK_TPM_API_H
#define OPENDOCK_TPM_API_H
#include <stdint.h>

/* Private, in-process ABI. No TCP ports, host TPM, or simulator debug RPCs. */
#define OD_TPM_ABI 1u
#define OD_TPM_BUFFER 4096u
typedef uint32_t (*OdTpmVersion)(void);
typedef int (*OdTpmOpen)(const char *utf8_path, int create);
typedef int (*OdTpmReset)(void);
typedef int (*OdTpmExecute)(uint8_t locality, const uint8_t *in, uint32_t in_len,
                          uint8_t *out, uint32_t *out_len);
typedef void (*OdTpmClose)(void);
#endif
