var express = require('express');
var db = require('../config/db');
var bcrypt = require('bcryptjs'); // https://github.com/dcodeIO/bcrypt.js
var jwt = require('jsonwebtoken'); // https://github.com/auth0/node-jsonwebtoken
var async = require('async');
const crypto = require('crypto');
require('dotenv').config();
var path = require('path');
var nm = require('../config/nm-conf');
var mdAutenticacion = require('../middlewares/autenticacion');
var SEED = process.env.SEED;
var CADUCIDAD_TOKEN = require('../config/config').CADUCIDAD_TOKEN;

var app = express();

/**
 * Rutas
 */
app.post('/', login)
    .post('/olvido', olvidoContrasena)
    .get('/restablecer', reset_password)
    .post('/restablecer', restablecerContrasena);

/**
 * Funciones
 */
function login(req, res) {
    var password = req.body.password;
    var usuario = req.body.usuario;
    db.oneOrNone('SELECT id, usuario, email, password, nombre, apellido, rol, img, social FROM usuarios WHERE usuario=$1 AND activo=true', [usuario])
        .then(usuario => {
            if (!usuario) {
                return res.status(400).json({
                    ok: false,
                    error: { name: 'Error en el login 😞', message: 'Usuario no encontrado' }
                });
            }

            if (usuario) {
                // Si la contraseña no coincide entre el password enviado con el password de BD
                if (!bcrypt.compareSync(password, usuario.password)) {
                    return res.status(400).json({
                        ok: false,
                        error: { name: 'Error en el login 😞', message: 'Verifique la contraseña' }
                    });
                }

                // En este punto el usuario y la contraseña son válidos
                // Crear un token (en este punto el correo y el password ya son correctos)
                usuario.password = '💩';
                var token = jwt.sign({ usuario: usuario }, SEED, { expiresIn: CADUCIDAD_TOKEN });
                usuario.token = token;

                res.status(200).json({
                    ok: true,
                    usuario: usuario,
                    //token: token,
                    id: usuario.id
                        //menu: obtenerMenu(usuarioBD.role)
                });
            }
        })
        .catch(err => {
            console.log('error:', err);
            res.status(400).send({
                ok: false,
                error: { name: 'Error en la conexión 😨', message: 'Verifique la conexión con la bd' }
            });
        });
}

function olvidoContrasena(req, res) {
    async.waterfall(
        [
            (done) => {
                db.oneOrNone('SELECT id, usuario, email, password, nombre, apellido, rol, img, social FROM usuarios WHERE usuario=$1 OR email=$1 AND activo=true', [req.body.usuario])
                    .then(user => {
                        if (user) {
                            done(null, user);
                        } else {
                            //done('User not found.');
                            return res.status(400).json({
                                ok: false,
                                error: { name: 'Error actualizando contraseña 😞', message: `Usuario o email ${req.body.usuario} no encontrado` }
                            });
                        }
                    });
            },
            (user, done) => {
                // create the random token
                /* crypto.randomBytes(20, function (err, buffer) {
                    var token = buffer.toString('hex');
                    done(err, user, token);
                }); */
                var token = jwt.sign({ usuario: user.usuario }, SEED, { expiresIn: '30m' });
                done(null, user, token);
            },
            (user, token, done) => {
                db.one('UPDATE usuarios SET estado=\'RESETEO_PASSWORD\' WHERE id=$1 RETURNING *;', [user.id])
                    .then(usuReseteo => {
                        if (usuReseteo) {
                            done(null, token, usuReseteo);
                        }
                        /*  else {
                                                    //done('User not found.');
                                                    return res.status(400).json({
                                                        ok: false,
                                                        error: { name: 'Error actualizando contraseña 😞', message: `Usuario ${req.body.usuario} no encontrado` }
                                                    }); 
                                                }*/
                    });
            },
            (token, user, done) => {
                var data = {
                    to: user.email,
                    from: nm.email,
                    template: 'forgot-password-email',
                    subject: 'Restablecer contraseña',
                    context: {
                        url: process.env.BACK_URL + '/login/restablecer?token=' + token,
                        name: user.nombre + ' ' + user.apellido
                    }
                };

                nm.sendMail(data, function(err) {
                    if (!err) {
                        res.status(200)
                            .json({
                                ok: true,
                                name: 'Email enviado 🤩',
                                message: `Se te ha enviado un correo a la dirección ${user.email} con los pasos para actualizar la contraseña`
                            });
                    } else {
                        return done(err);
                    }
                });
            }
        ], (err) => {
            return res.status(422).json({ message: err });
        });
};

function restablecerContrasena(req, res, next) {
    var token = req.body.token;
    jwt.verify(token, SEED, (err, decoded) => {
        if (err) {
            return res.status(400).send({
                error: { name: 'Error actualizando contraseña ☹️', message: 'El token de restablecimiento de contraseña no es válido o ha expirado', icono: 'error' }
            });
        } else {
            req.usuario = decoded.usuario;
            db.oneOrNone('SELECT id, usuario, email, nombre, apellido, estado FROM usuarios WHERE usuario=$1 AND activo=true', [req.usuario])
                .then(usuario => {
                    if (usuario.estado === 'RESETEO_PASSWORD') {

                        if (req.body.newPassword === req.body.verifyPassword) {

                            if (req.body.newPassword.length < 5) {
                                return res.status(422).send({
                                    ok: false,
                                    error: { name: 'Error actualizando contraseña 😮', message: 'La contraseña es muy pequeña', icono: 'warning' }
                                });
                            }
                            // Actualizo la contraseña del usuario
                            var password = bcrypt.hashSync(req.body.newPassword, 10);
                            db.result('UPDATE usuarios SET password=$1, estado=\'REGISTRADO\' WHERE usuario=$2 and activo = true;', [password, usuario.usuario])
                                .then(result => {
                                    if (result.rowCount > 0) {
                                        res.status(200)
                                            .json({
                                                ok: true,
                                                name: 'Contraseña restablecida 😄',
                                                message: `Se actualizó la contraseña del usuario ${usuario.usuario}`
                                            });
                                        var data = {
                                            to: usuario.email,
                                            from: nm.email,
                                            template: 'reset-password-email',
                                            subject: 'Confirmación de actualización de contraseña',
                                            context: {
                                                url: process.env.FRONT_URL + '/login',
                                                name: usuario.nombre + ' ' + usuario.apellido
                                            }
                                        };

                                        nm.sendMail(data, function(err) {
                                            if (!err) {
                                                return res.json({ message: 'Reseteo de contraseña' });
                                            } else {
                                                return res.status(400).send({
                                                    err
                                                });
                                            }
                                        });
                                    } else {
                                        res.status(400).send({
                                            ok: false,
                                            error: { name: 'Error actualizando contraseña 😱', message: 'El usuario no fue encontrado', icono: 'error' }
                                        });
                                    }
                                })
                                .catch(err => {
                                    res.status(400).send({
                                        ok: false,
                                        error: { name: 'Error actualizando contraseña 😵', message: 'Error en la base de datos', icono: 'error' }
                                    });
                                });
                        } else {
                            return res.status(422).send({
                                ok: false,
                                error: { name: 'Error actualizando contraseña 😯', message: 'Las contraseñas no coinciden', icono: 'warning' }
                            });
                        }
                    } else {
                        return res.status(400).send({
                            error: { name: 'Aviso 🤨', message: 'El token ha expirado, la contraseña ya fue actualizada, puede iniciar sesión', icono: 'info', redireccionar: true }
                        });
                    }
                });
        }
    });
}

function reset_password(req, res) {
    return res.sendFile(path.resolve('./public/restablecer.html'));
};

module.exports = app;