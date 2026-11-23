declare namespace App {
    interface Locals {
        /** The signed-in admin, set by the middleware from the session cookie. */
        admin?: import('./server/Sessions.ts').Admin;
    }
}
