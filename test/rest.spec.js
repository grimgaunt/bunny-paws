'use strict';

var express = require('express');
var bunnyPawsModule = require('../lib/index.js');
var config = require('./config.js');
var sinon = require('sinon');
var chai = require('chai');
chai.use(require('sinon-chai'));
var expect = chai.expect;
var Promise = require('bluebird');
var jackrabbit = require('jackrabbit');
var $http = require('http-as-promised');

describe('BunnyPaws registerRoutes', function () {

    var app;
    var server;
    var bunnyPaws;
    var restBunnyPaws;
    var baseUrl;

    function makeUrl(href) {
        return baseUrl + href;
    }

    before(function () {
        app = express();
        server = app.listen(config.port);
        baseUrl = 'http://localhost:' + config.port + '/api';
        console.log('Listening on port', config.port);
        return bunnyPawsModule.registerRoutes(app, baseUrl, config.amqp.url, config.amqp.httpApiPort).then(function (result) {
            restBunnyPaws = result;
        });
    });

    after(function () {
        server.close();
        return bunnyPaws.disconnect().then(function () {
            return restBunnyPaws.disconnect();
        });
    });

    describe('when message is published', function () {
        var consumerSpyA;
        var consumerSpyB;
        var queueNameA = 'tasks';
        var queueNameB = 'szazalakacu';
        var publishingRabbit;
        var consumingRabbit;

        function purgeQueues() {
            var purgatoryRabbit = jackrabbit(config.amqp.url);
            return new Promise(function (resolve, reject) {
                var defaultExchange = purgatoryRabbit.default();
                defaultExchange.on('connected', function (channel) {
                    var promiseA = new Promise(function (resolve, reject) {
                        channel.assertQueue(queueNameA);
                        channel.purgeQueue(queueNameA, function (err) {
                            if (err) {
                                reject(err);
                            }
                            else {
                                resolve();
                            }
                        });
                    });
                    var promiseB = new Promise(function (resolve, reject) {
                        channel.assertQueue(queueNameB);
                        channel.purgeQueue(queueNameB, function (err) {
                            if (err) {
                                reject(err);
                            }
                            else {
                                resolve();
                            }
                        });
                    });
                    Promise.all([promiseA, promiseB]).then(resolve, reject);
                });
            }).finally(function () {
                    return Promise.delay(100).then(function () {
                        purgatoryRabbit.close();
                    });
                });
        }

        beforeEach(function () {
            return purgeQueues().then(function () {
                publishingRabbit = jackrabbit(config.amqp.url);
                publishingRabbit.default()
                    .publish('a', { key: queueNameA })
                    .publish('b', { key: queueNameB });

                consumerSpyA = sinon.spy(function (data, ack) {
                    ack();
                });
                consumerSpyB = sinon.spy(function (data, ack) {
                    ack();
                });
                bunnyPaws = new bunnyPawsModule.newInstance(config.amqp.url);
                consumingRabbit = jackrabbit(config.amqp.url);
                var queueA = consumingRabbit.default().queue({ name: queueNameA });
                var queueB = consumingRabbit.default().queue({ name: queueNameB });
                bunnyPaws.addPauseResume(queueA.consume(consumerSpyA));
                bunnyPaws.addPauseResume(queueB.consume(consumerSpyB));


                return Promise.delay(500);
            });
        });
        afterEach(function () {
            return new Promise(function (resolve, reject) {
                if (consumingRabbit) {
                    consumingRabbit.close(function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                } else {
                    resolve();
                }
            }).then(function () {
                    return new Promise(function (resolve, reject) {
                        if (publishingRabbit) {
                            publishingRabbit.close(function (err) {
                                if (err) {
                                    reject(err);
                                }
                                else {
                                    resolve();
                                }
                            });
                        }
                    });
                }).then(function () {
                    return bunnyPaws.disconnect();
                });
        });

        it('should be consumed', function () {
            expect(consumerSpyA).to.have.been.callCount(1);
            expect(consumerSpyB).to.have.been.callCount(1);
        });

        describe('and pause invoked', function () {
            var pausePromise;
            var resumePromise;
            beforeEach(function () {
                pausePromise = $http.post(makeUrl('/queues/pause'));
                return pausePromise.then(function () {
                    return Promise.delay(100);
                });
            });
            it('should respond with metrics url in body', function () {
                return pausePromise.spread(function (res, body) {
                    body = JSON.parse(body);
                    expect(body).to.eql({metrics: makeUrl('/queues/')});
                });
            });
            it('should respond with metrics url in header', function () {
                return pausePromise.spread(function (res) {
                    expect(res.headers.location).to.equal(makeUrl('/queues/'));
                });
            });
            it('should be able to get metrics from provided url', function () {
                return pausePromise.spread(function (res) {
                    return $http.get(res.headers.location).spread(function (res, body) {
                        body = JSON.parse(body);
                        expect(body).to.have.length.above(0);
                        expect(body[0]).to.have.property('messages');
                    });
                });
            });
            describe('and another message is published', function () {
                beforeEach(function () {
                    publishingRabbit.default()
                        .publish('aa', { key: queueNameA })
                        .publish('bb', { key: queueNameB });

                    return Promise.delay(100);
                });
                it('should not consume the message in queue', function () {
                    expect(consumerSpyA).to.have.been.callCount(1);
                    expect(consumerSpyB).to.have.been.callCount(1);
                });
                describe('and resume invoked', function () {
                    beforeEach(function () {
                        resumePromise = $http.post(makeUrl('/queues/resume'));
                        return pausePromise.then(function () {
                            return Promise.delay(100);
                        });
                    });
                    it('should respond with metrics url in body', function () {
                        return resumePromise.spread(function (res, body) {
                            body = JSON.parse(body);
                            expect(body).to.eql({metrics: makeUrl('/queues/')});
                        });
                    });
                    it('should respond with metrics url in header', function () {
                        return resumePromise.spread(function (res) {
                            expect(res.headers.location).to.equal(makeUrl('/queues/'));
                        });
                    });
                    it('should be able to get metrics from provided url', function () {
                        return resumePromise.spread(function (res) {
                            return $http.get(res.headers.location).spread(function (res, body) {
                                body = JSON.parse(body);
                                expect(body).to.have.length.above(0);
                                expect(body[0]).to.have.property('messages');
                            });
                        });
                    });
                    it('should consume the message', function () {
                        expect(consumerSpyA).to.have.been.callCount(2);
                        expect(consumerSpyB).to.have.been.callCount(2);
                    });
                });

            });
        });

        describe('and pause invoked for queueB', function () {
            var pausePromise;
            var resumePromise;
            beforeEach(function () {
                pausePromise = $http.post(makeUrl('/queues/' + queueNameB + '/pause'));
                return pausePromise.then(function () {
                    return Promise.delay(100);
                });
            });
            it('should respond with metrics url in body', function () {
                return pausePromise.spread(function (res, body) {
                    body = JSON.parse(body);
                    expect(body).to.eql({metrics: makeUrl('/queues/' + queueNameB)});
                });
            });
            it('should respond with metrics url in header', function () {
                return pausePromise.spread(function (res) {
                    expect(res.headers.location).to.equal(makeUrl('/queues/' + queueNameB));
                });
            });
            it('should be able to get metrics from provided url', function () {
                return pausePromise.spread(function (res) {
                    return $http.get(res.headers.location).spread(function (res, body) {
                        body = JSON.parse(body);
                        expect(body).to.have.property('messages');
                        expect(body).to.have.property('name', queueNameB);
                    });
                });
            });
            describe('and another message is published', function () {
                beforeEach(function () {
                    publishingRabbit.default()
                        .publish('aa', { key: queueNameA })
                        .publish('bb', { key: queueNameB });

                    return Promise.delay(100);
                });
                it('should consume the message in queue A', function () {
                    expect(consumerSpyA).to.have.been.callCount(2);
                });
                it('should NOT consume the message in queue B', function () {
                    expect(consumerSpyB).to.have.been.callCount(1);
                });
                describe('and resume invoked for queueB', function () {
                    beforeEach(function () {
                        resumePromise = $http.post(makeUrl('/queues/' + queueNameB + '/resume'));
                        return pausePromise.then(function () {
                            return Promise.delay(100);
                        });
                    });
                    it('should respond with metrics url in body', function () {
                        return resumePromise.spread(function (res, body) {
                            body = JSON.parse(body);
                            expect(body).to.eql({metrics: makeUrl('/queues/' + queueNameB)});
                        });
                    });
                    it('should respond with metrics url in header', function () {
                        return resumePromise.spread(function (res) {
                            expect(res.headers.location).to.equal(makeUrl('/queues/' + queueNameB));
                        });
                    });
                    it('should be able to get metrics from provided url', function () {
                        return resumePromise.spread(function (res) {
                            return $http.get(res.headers.location).spread(function (res, body) {
                                body = JSON.parse(body);
                                expect(body).to.have.property('messages');
                                expect(body).to.have.property('name', queueNameB);
                            });
                        });
                    });
                    it('should consume the message', function () {
                        expect(consumerSpyA).to.have.been.callCount(2);
                        expect(consumerSpyB).to.have.been.callCount(2);
                    });
                });
                describe('and resume invoked for all queues', function () {
                    beforeEach(function () {
                        resumePromise = $http.post(makeUrl('/queues/resume'));
                        return pausePromise.then(function () {
                            return Promise.delay(100);
                        });
                    });
                    it('should be able to get metrics from provided url', function () {
                        return resumePromise.spread(function (res) {
                            return $http.get(res.headers.location).spread(function (res, body) {
                                body = JSON.parse(body);
                                expect(body).to.have.length.above(0);
                                expect(body[0]).to.have.property('messages');
                            });
                        });
                    });
                    it('should consume the message', function () {
                        expect(consumerSpyA).to.have.been.callCount(2);
                        expect(consumerSpyB).to.have.been.callCount(2);
                    });
                });
            });
        });

        describe('and pause invoked for all queues', function () {
            beforeEach(function () {
                return $http.post(makeUrl('/queues/pause')).then(function () {
                    return Promise.delay(100);
                });
            });

            describe('and another message is published', function () {
                beforeEach(function () {
                    publishingRabbit.default()
                        .publish('aa', { key: queueNameA })
                        .publish('bb', { key: queueNameB });

                    return Promise.delay(100);
                });
                it('should NOT consume the message', function () {
                    expect(consumerSpyA).to.have.been.callCount(1);
                    expect(consumerSpyB).to.have.been.callCount(1);
                });
                describe('and resume invoked for all queues', function () {
                    beforeEach(function () {
                        return $http.post(makeUrl('/queues/resume')).then(function () {
                            return Promise.delay(100);
                        });
                    });
                    it('should consume the message', function () {
                        expect(consumerSpyA).to.have.been.callCount(2);
                        expect(consumerSpyB).to.have.been.callCount(2);
                    });
                });
            });
        });
    });
});
