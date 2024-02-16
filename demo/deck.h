// deck: a utility library for writing score cards

#ifdef __EMSCRIPTEN__
    #include <emscripten.h>

    EMSCRIPTEN_KEEPALIVE void setup(unsigned int seed);
    EMSCRIPTEN_KEEPALIVE float process();

    #define debug(...)
#else
    // This supports debugging by running natively.
    // To use this, just do an ordinary (non-Emscripten) build,
    // and run the program with the output piped into `sox -tf32 -r 44.1k - -d`.
    // (To generate debug output, just print to stderr instead of stdout.)
    #define EMSCRIPTEN_KEEPALIVE
    #include <stdio.h>
    #include <time.h>

    #define debug(...) fprintf(stderr, __VA_ARGS__)

    void setup(unsigned int seed) __attribute__((weak));
    float process();

    int main() {
        if (setup) {
            setup(time(NULL));
        }
        for (;;) {
            float x = process();
            fwrite(&x, 4, 1, stdout);
        }
        return 0;
    }
#endif

#include <stdlib.h>
#include <math.h>
#include <inttypes.h>

#define card_title(s) EMSCRIPTEN_KEEPALIVE char title[] = s
#define setup_rand void setup(unsigned int seed) { srand(seed); }

#define SIZEOF(arr) (sizeof(arr) / sizeof(*arr))

#define SAMPLE_RATE (44100.0)
float dt = 1.0 / SAMPLE_RATE;

// Randomness
#define choice(arr) (arr[rand() % SIZEOF(arr)])

float uniform(float a, float b) {
    return rand() / (float)RAND_MAX * (b - a) + a;
}

float noise() {
    return rand() / (float)RAND_MAX * 2 - 1;
}

// Oscillators
typedef float (*osc_func)(float *state, float freq);

#define define_osc(name, expression) \
    float name(float *pphase, float freq) { \
        const float phase = *pphase; \
        float x = expression; \
        *pphase += freq * dt; \
        *pphase -= truncf(*pphase); \
        return x; \
    }
// NOTE: These are all aliasing.
define_osc(sqr, phase < 0.5 ? -1 : 1)
define_osc(saw, phase * 2 - 1)
define_osc(tri, (phase < 0.5 ? phase : 1 - phase) * 4 - 1)

// Envelopes
float env(float t, float dur) {
    float x = 1 - t / dur;
    return x * x;
}

float env_gen(float *t, float dur) {
    float x = 1 - *t / dur;
    *t += dt;
    return x * x;
}

float ad(float t, float attack, float decay) {
    return t < attack ? (t / attack) : (1 - (t - attack) / decay);
}

float ramp(float t, float dur, float start, float end) {
    return t / dur * (end - start) + start;
}

// Misc
// float m2f(float pitch) {
//     return powf(2, (pitch - 69)/12.0) * 440;
// }

float m2f(int pitch) {
    // This approach saves 458 bytes compared to using powf(),
    // with the downside that it only handles 12TET.
    float freq = 440;
    pitch -= 69;
    while (pitch-- > 1) freq *= 1.0594630943592953;
    while (pitch++ < 0) freq *= 0.9438743126816935;
    return freq;
}



// Generators
// Adapted from Simon Tatham's work on coroutines in C: https://www.chiark.greenend.org.uk/~sgtatham/coroutines.html
// NOTE: Clang doesn't support pointers-to-labels extension with Wasm backend, so we stick with Duff's device.

// Static generators: state is stored in static variables, so only one generator may be active at a time.
#define gen_begin static int gen_line_number = 0; switch (gen_line_number) { case 0:;
#define gen_end(x) } gen_line_number = -1; return x

#define yield(...)                              \
    do {                                        \
        gen_line_number = __LINE__;             \
        return (__VA_ARGS__); case __LINE__:;   \
    } while (0)


// For use with re-entrant generators (see below).
#define yield_from(generator, state)                 \
    do {                                                 \
        gen_line_number = __LINE__;                      \
        typeof(generator(&state)) x = generator(&state); \
        if (state.line_number == -1) break;              \
        return x; case __LINE__:;                        \
    } while (state.line_number != -1)

#define yield_from_args(generator, state, ...)       \
    do {                                                 \
        gen_line_number = __LINE__;                      \
        typeof(generator(&state, __VA_ARGS__)) x = generator(&state, __VA_ARGS__); \
        if (state.line_number == -1) break;              \
        return x; case __LINE__:;                        \
    } while (state.line_number != -1)



// "Re-entrant" generators: generator state is stored in a struct, so multiple generators of the same type can be active at once.
// Unlike Tatham's `coroutine.h`, we avoid heap allocation to avoid bringing an allocator into the binary.
// Because of this, the re-entrant generator's variables must be declared outside of the function body.
#define regen_vars(a, ...) typedef struct a##_state { int line_number; __VA_ARGS__; } a##_state;
#define regen_init(state) (state.line_number = 0)
#define regen_begin switch (self->line_number) { case 0:;
#define regen_end(x) } self->line_number = -1; return x

#define reyield(x)                             \
    do {                                        \
        self->line_number = __LINE__;             \
        return (x); case __LINE__:;             \
    } while (0)


// For use with re-entrant generators:
#define reyield_from(generator, state, ...)                            \
    do {                                                                 \
        self->line_number = __LINE__;                                    \
        typeof(generator(&state, __VA_ARGS__)) x = generator(&state, __VA_ARGS__); \
        if (state.line_number == -1) break;                             \
        return x; case __LINE__:;                                       \
    } while (state.line_number != -1)

#define reyield_from_args(generator, state, ...)        \
    do {                                                 \
        self->line_number = __LINE__;                      \
        typeof(generator(&state, __VA_ARGS__)) x = generator(&state, __VA_ARGS__); \
        if (state.line_number == -1) break;              \
        return x; case __LINE__:;                        \
    } while (state.line_number != -1)


#define sleep(t, dur) for (; t < dur; t += dt) yield(0); t -= dur
#define resleep(t, dur) for (; t < dur; t += dt) reyield(0); t -= dur
