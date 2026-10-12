// Surface attachment follows mpv-android (MIT); see licenses/mpv-android-MIT.txt.
// Each Activity owns its handle. No global player, worker callback, media URL logging or abort().
#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "mpv/client.h"

extern int mpv_lavc_set_java_vm(void *vm);
typedef struct { mpv_handle *mpv; jobject surface; int problem; int network; char *gpu_stats; int gpu_stats_pending; } Player;
#define FN(name) Java_com_genzo_android_MpvNative_##name
#define P ((Player *)(intptr_t)handle)

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    mpv_lavc_set_java_vm(vm);
    return JNI_VERSION_1_6;
}
JNIEXPORT jlong JNICALL FN(create)(JNIEnv *env, jobject self) {
    Player *p = calloc(1, sizeof(Player));
    if (!p) return 0;
    p->mpv = mpv_create();
    if (!p->mpv) { free(p); return 0; }
    return (jlong)(intptr_t)p;
}
JNIEXPORT jint JNICALL FN(option)(JNIEnv *env, jobject self, jlong handle, jstring key, jstring value) {
    const char *k = (*env)->GetStringUTFChars(env, key, NULL);
    const char *v = (*env)->GetStringUTFChars(env, value, NULL);
    int result = mpv_set_option_string(P->mpv, k, v);
    (*env)->ReleaseStringUTFChars(env, key, k); (*env)->ReleaseStringUTFChars(env, value, v);
    return result;
}
JNIEXPORT jint JNICALL FN(init)(JNIEnv *env, jobject self, jlong handle) {
    int result = mpv_initialize(P->mpv);
    if (result >= 0) mpv_request_log_messages(P->mpv, "warn");
    return result;
}
JNIEXPORT jint JNICALL FN(command)(JNIEnv *env, jobject self, jlong handle, jobjectArray args) {
    int n = (*env)->GetArrayLength(env, args);
    if (n > 32) return MPV_ERROR_INVALID_PARAMETER;
    const char *values[33] = {0}; jstring strings[32];
    for (int i = 0; i < n; i++) {
        strings[i] = (*env)->GetObjectArrayElement(env, args, i);
        values[i] = (*env)->GetStringUTFChars(env, strings[i], NULL);
    }
    if (n > 1 && strcmp(values[0], "loadfile") == 0) {
        P->problem = 0;
        P->network = strncmp(values[1], "http://", 7) == 0 || strncmp(values[1], "https://", 8) == 0;
    }
    int result = mpv_command(P->mpv, values);
    for (int i = 0; i < n; i++) {
        (*env)->ReleaseStringUTFChars(env, strings[i], values[i]); (*env)->DeleteLocalRef(env, strings[i]);
    }
    return result;
}
JNIEXPORT jint JNICALL FN(commandAsync)(JNIEnv *env, jobject self, jlong handle, jobjectArray args) {
    int n = (*env)->GetArrayLength(env, args);
    if (n > 32) return MPV_ERROR_INVALID_PARAMETER;
    const char *values[33] = {0}; jstring strings[32];
    for (int i = 0; i < n; i++) {
        strings[i] = (*env)->GetObjectArrayElement(env, args, i);
        values[i] = (*env)->GetStringUTFChars(env, strings[i], NULL);
    }
    int result = mpv_command_async(P->mpv, 42, values);
    for (int i = 0; i < n; i++) {
        (*env)->ReleaseStringUTFChars(env, strings[i], values[i]); (*env)->DeleteLocalRef(env, strings[i]);
    }
    return result;
}
JNIEXPORT jstring JNICALL FN(get)(JNIEnv *env, jobject self, jlong handle, jstring key) {
    const char *k = (*env)->GetStringUTFChars(env, key, NULL);
    // vo-passes waits on the render thread. Profiling must not block Android controls.
    if (strcmp(k, "vo-passes") == 0) {
        if (!P->gpu_stats_pending && mpv_get_property_async(P->mpv, 43, k, MPV_FORMAT_STRING) >= 0) P->gpu_stats_pending = 1;
        (*env)->ReleaseStringUTFChars(env, key, k);
        return P->gpu_stats ? (*env)->NewStringUTF(env, P->gpu_stats) : NULL;
    }
    char *value = mpv_get_property_string(P->mpv, k);
    (*env)->ReleaseStringUTFChars(env, key, k);
    if (!value) return NULL;
    jstring result = (*env)->NewStringUTF(env, value); mpv_free(value); return result;
}
JNIEXPORT jint JNICALL FN(set)(JNIEnv *env, jobject self, jlong handle, jstring key, jstring value) {
    const char *k = (*env)->GetStringUTFChars(env, key, NULL);
    const char *v = (*env)->GetStringUTFChars(env, value, NULL);
    int result = mpv_set_property_string(P->mpv, k, v);
    (*env)->ReleaseStringUTFChars(env, key, k); (*env)->ReleaseStringUTFChars(env, value, v);
    return result;
}
JNIEXPORT jint JNICALL FN(surface)(JNIEnv *env, jobject self, jlong handle, jobject surface) {
    // Switch vo off synchronously before releasing the previous global Surface reference.
    mpv_set_property_string(P->mpv, "vo", "null");
    mpv_set_property_string(P->mpv, "force-window", "no");
    int64_t wid = 0; mpv_set_option(P->mpv, "wid", MPV_FORMAT_INT64, &wid);
    if (P->surface) (*env)->DeleteGlobalRef(env, P->surface);
    P->surface = surface ? (*env)->NewGlobalRef(env, surface) : NULL;
    wid = (int64_t)(intptr_t)P->surface;
    return mpv_set_option(P->mpv, "wid", MPV_FORMAT_INT64, &wid);
}
JNIEXPORT jint JNICALL FN(poll)(JNIEnv *env, jobject self, jlong handle) {
    int flags = 0;
    for (int i = 0; i < 128; i++) {
        mpv_event *event = mpv_wait_event(P->mpv, 0);
        if (event->event_id == MPV_EVENT_NONE) break;
        if (event->event_id == MPV_EVENT_GET_PROPERTY_REPLY && event->reply_userdata == 43) {
            P->gpu_stats_pending = 0;
            mpv_event_property *property = event->data;
            if (event->error >= 0 && property->data && property->format == MPV_FORMAT_STRING) {
                char *text = *(char **)property->data;
                free(P->gpu_stats); P->gpu_stats = text ? strdup(text) : NULL;
            }
        }
        if (event->event_id == MPV_EVENT_COMMAND_REPLY && event->reply_userdata == 42 && event->error < 0) { P->problem = 1; flags |= 16; }
        if (event->event_id == MPV_EVENT_FILE_LOADED) flags |= 1;
        if (event->event_id == MPV_EVENT_PLAYBACK_RESTART) flags |= 2;
        if (event->event_id == MPV_EVENT_END_FILE) {
            mpv_event_end_file *end = event->data;
            if (end->reason == MPV_END_FILE_REASON_ERROR) {
                flags |= 8;
                if (!P->problem) {
                    if (end->error == MPV_ERROR_VO_INIT_FAILED) P->problem = 1;
                    else if (end->error == MPV_ERROR_AO_INIT_FAILED) P->problem = 7;
                    else if (end->error == MPV_ERROR_UNKNOWN_FORMAT || end->error == MPV_ERROR_UNSUPPORTED) P->problem = 6;
                    else if (end->error == MPV_ERROR_LOADING_FAILED) P->problem = P->network ? 3 : 9;
                }
            }
            else if (end->reason == MPV_END_FILE_REASON_EOF) flags |= 4;
        }
        if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
            mpv_event_log_message *log = event->data;
            // Keep only bounded categories. Never return or persist log text containing URLs.
            if (log->log_level <= MPV_LOG_LEVEL_WARN) {
                if (strstr(log->text, "HTTP error 401") || strstr(log->text, "HTTP error 403") || strstr(log->text, "Server returned 401") || strstr(log->text, "Server returned 403")) P->problem = 4;
                else if (strstr(log->text, "HTTP error 404") || strstr(log->text, "HTTP error 410") || strstr(log->text, "Server returned 404") || strstr(log->text, "Server returned 410")) P->problem = 5;
                else if (strstr(log->text, "Connection timed out")) P->problem = 8;
                else if (log->log_level <= MPV_LOG_LEVEL_ERROR) {
                    if (strstr(log->prefix, "vo/gpu") || strstr(log->prefix, "libplacebo")) { P->problem = 1; flags |= 16; }
                    else if (strstr(log->prefix, "vd") && !P->problem) P->problem = 2;
                }
            }
        }
    }
    return flags;
}
JNIEXPORT jint JNICALL FN(problem)(JNIEnv *env, jobject self, jlong handle) { return handle ? P->problem : 0; }
JNIEXPORT void JNICALL FN(destroy)(JNIEnv *env, jobject self, jlong handle) {
    if (!handle) return;
    mpv_terminate_destroy(P->mpv);
    if (P->surface) (*env)->DeleteGlobalRef(env, P->surface);
    free(P->gpu_stats); free(P);
}
